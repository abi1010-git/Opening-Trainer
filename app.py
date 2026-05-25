from collections import Counter
from flask import Flask, jsonify, request, render_template
from werkzeug.exceptions import HTTPException
import chess
import chess.pgn
import chess.engine
import io
import lichess.api
from lichess.format import SINGLE_PGN
import csv
import os
import re
import requests
import shutil
import threading
import time
from urllib.parse import quote
import uuid

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MAX_FILTER_SCAN_GAMES = int(os.environ.get("MAX_FILTER_SCAN_GAMES", "200"))

app = Flask(__name__)
JOBS = {}
JOBS_LOCK = threading.Lock()
JOB_TTL_SECONDS = 60 * 60


class LichessUserNotFound(ValueError):
    pass


class LichessRequestError(RuntimeError):
    pass


@app.errorhandler(Exception)
def handle_error(error):
    if not request.path.startswith("/lichess/"):
        if isinstance(error, HTTPException):
            return error
        raise error

    if isinstance(error, HTTPException):
        status_code = error.code or 500
        message = error.description
    elif isinstance(error, LichessUserNotFound):
        status_code = 404
        message = str(error)
    elif isinstance(error, LichessRequestError):
        status_code = 502
        message = str(error)
    else:
        status_code = 500
        message = str(error) or "Unexpected server error"
        app.logger.exception("Unhandled analysis error")

    return jsonify({"error": message}), status_code


# ---------------------- Engine helpers ----------------------
MOVE_NUMBER_RE = re.compile(r"^\d+\.(?:\.\.)?")


def resolve_stockfish_path():
    configured_path = os.environ.get("STOCKFISH_PATH")
    candidates = [
        configured_path,
        os.path.join(BASE_DIR, "engine", "stockfish.exe"),
        os.path.join(BASE_DIR, "engine", "stockfish"),
        shutil.which("stockfish"),
        "/usr/games/stockfish",
        "/usr/bin/stockfish",
    ]

    for candidate in candidates:
        if not candidate:
            continue
        if os.path.exists(candidate):
            return candidate

        resolved = shutil.which(candidate)
        if resolved:
            return resolved

    return None


def opening_tokens(moves_text: str):
    tokens = []
    for raw_token in (moves_text or "").replace("\n", " ").split():
        token = raw_token.strip()
        token = MOVE_NUMBER_RE.sub("", token)
        token = token.strip()
        if not token or token in {"*", "1-0", "0-1", "1/2-1/2"}:
            continue
        tokens.append(token.replace("0-0", "O-O"))
    return tokens


def opening_move_sequence(moves_text: str):
    board = chess.Board()
    sequence = []
    san_sequence = []

    for token in opening_tokens(moves_text):
        try:
            move = board.parse_san(token)
        except ValueError:
            return None, None

        san_sequence.append(board.san(move))
        sequence.append(move.uci())
        board.push(move)

    return tuple(sequence), tuple(san_sequence)


def clean_opening_name(name: str, eco: str | None = None) -> str:
    cleaned = (name or "").strip().strip(";")
    if eco:
        cleaned = re.sub(rf"(?:\s*;\s*|\s+){re.escape(eco)}$", "", cleaned).strip()
    return cleaned or eco or "Unknown"


def load_opening_data(path="data/openings.csv"):
    """
    Build an exact move-prefix opening database from the ECO CSV.
    Rows that cannot be parsed as legal SAN are skipped instead of guessed.
    """
    by_eco = {}
    all_lines = []
    eco_map = {}
    skipped = 0
    abs_path = os.path.join(BASE_DIR, path)
    if not os.path.exists(abs_path):
        print("ECO CSV not found:", abs_path)
        return by_eco, all_lines, eco_map

    with open(abs_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            eco = (row.get("ECO") or "").strip()
            name = clean_opening_name(row.get("name"), eco)
            moves = (row.get("moves") or "").strip()
            if not eco or not name or not moves:
                continue

            eco_map.setdefault(eco, name)
            move_sequence, san_sequence = opening_move_sequence(moves)
            if not move_sequence:
                skipped += 1
                continue

            entry = {
                "eco": eco,
                "name": name,
                "moves": " ".join(san_sequence),
                "move_sequence": move_sequence,
                "plies": len(move_sequence),
            }
            all_lines.append(entry)
            by_eco.setdefault(eco, []).append(entry)

    all_lines.sort(key=lambda entry: entry["plies"], reverse=True)
    for entries in by_eco.values():
        entries.sort(key=lambda entry: entry["plies"], reverse=True)

    print(f"Loaded {len(all_lines)} opening lines for {len(by_eco)} ECO codes")
    if skipped:
        print(f"Skipped {skipped} unparsable opening rows")
    return by_eco, all_lines, eco_map


def set_job_status(job_id, **updates):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job.update(updates)
        job["updated_at"] = time.time()


def cleanup_jobs():
    cutoff = time.time() - JOB_TTL_SECONDS
    with JOBS_LOCK:
        expired = [job_id for job_id, job in JOBS.items() if job.get("updated_at", 0) < cutoff]
        for job_id in expired:
            JOBS.pop(job_id, None)

OPENINGS_BY_ECO, OPENING_LINES, ECO_MAP = load_opening_data()
MAX_OPENING_PLIES = max((entry["plies"] for entry in OPENING_LINES), default=20)

def first_info(info):
    # python-chess may return a dict OR a list (multipv-style)
    return info[0] if isinstance(info, list) else info


def get_best_move_uci(info, engine: chess.engine.SimpleEngine, board: chess.Board, depth: int):
    pv = (info or {}).get("pv") or []
    if pv:
        return pv[0].uci()
    if board.is_game_over():
        return None
    result = engine.play(board, chess.engine.Limit(depth=depth))
    return result.move.uci() if result.move else None


def move_san_from_uci(board: chess.Board, uci: str | None) -> str | None:
    if not uci:
        return None
    try:
        move = chess.Move.from_uci(uci)
        if move in board.legal_moves:
            return board.san(move)
    except ValueError:
        return None
    return None


def score_to_pawns(score_obj) -> float:
    """
    Convert a python-chess score to pawns from White POV.
    Mate scores are mapped to +/-100.0 for readability.
    """
    s = score_obj.pov(chess.WHITE)
    mate = s.mate()
    if mate is not None:
        return 100.0 if mate > 0 else -100.0
    return (s.score(mate_score=100000) or 0) / 100.0


def mate_in(score_obj):
    """Return mate in N (White POV), or None."""
    return score_obj.pov(chess.WHITE).mate()


def classify_mistake(drop_for_mover: float, mate_after_n):
    """
    drop_for_mover: positive means the mover's position got worse.
    mate_after_n: White POV; negative means Black is mating.
    """
    if mate_after_n is not None and mate_after_n < 0:
        return "tactical:mate"
    if drop_for_mover >= 2.0:
        return "tactical:blunder"
    if drop_for_mover >= 1.0:
        return "tactical:mistake"
    if drop_for_mover >= 0.6:
        return "positional:inaccuracy"
    return "ok"

def game_prefix_san(game: chess.pgn.Game, max_fullmoves: int = 6) -> str:
    board = game.board()
    parts = []
    fullmove = 1

    for move in game.mainline_moves():
        san = board.san(move)
        if board.turn == chess.WHITE:
            parts.append(f"{fullmove}.{san}")
        else:
            parts.append(san)

        board.push(move)
        if board.turn == chess.WHITE:
            fullmove += 1
            if fullmove > max_fullmoves:
                break

    return " ".join(parts)


def game_move_sequence(game: chess.pgn.Game, max_plies: int | None = None):
    sequence = []
    for move in game.mainline_moves():
        sequence.append(move.uci())
        if max_plies and len(sequence) >= max_plies:
            break
    return tuple(sequence)


def entry_matches_game(entry, game_sequence):
    opening_sequence = entry["move_sequence"]
    return len(opening_sequence) <= len(game_sequence) and game_sequence[:len(opening_sequence)] == opening_sequence


def opening_label(eco: str | None, name: str | None) -> str:
    clean_name = clean_opening_name(name, eco)
    if eco and clean_name and not clean_name.startswith(f"{eco} "):
        return f"{eco} - {clean_name}"
    return clean_name or eco or "Unknown"


def best_opening_info(game: chess.pgn.Game, eco: str | None):
    game_sequence = game_move_sequence(game, max_plies=MAX_OPENING_PLIES)
    candidates = OPENINGS_BY_ECO.get(eco) or []

    for entry in candidates:
        if entry_matches_game(entry, game_sequence):
            return {
                "label": opening_label(entry["eco"], entry["name"]),
                "eco": entry["eco"],
                "name": entry["name"],
                "moves": entry["moves"],
                "matched_plies": entry["plies"],
                "source": "eco_exact",
            }

    for entry in OPENING_LINES:
        if entry_matches_game(entry, game_sequence):
            return {
                "label": opening_label(entry["eco"], entry["name"]),
                "eco": entry["eco"],
                "name": entry["name"],
                "moves": entry["moves"],
                "matched_plies": entry["plies"],
                "source": "book_exact",
            }

    opening_hdr = game.headers.get("Opening")
    if opening_hdr:
        return {
            "label": opening_label(eco, opening_hdr),
            "eco": eco,
            "name": clean_opening_name(opening_hdr, eco),
            "moves": None,
            "matched_plies": 0,
            "source": "lichess_header",
        }

    fallback_name = ECO_MAP.get(eco)
    return {
        "label": opening_label(eco, fallback_name),
        "eco": eco,
        "name": fallback_name or eco or "Unknown",
        "moves": None,
        "matched_plies": 0,
        "source": "eco_fallback" if eco else "unknown",
    }


def best_opening_name(game: chess.pgn.Game, eco: str | None) -> str:
    return best_opening_info(game, eco)["label"]



# ---------------------- Basic routes ----------------------
@app.get("/health")
def health():
    return {"status": "ok", "stockfish_found": bool(resolve_stockfish_path())}


@app.get("/routes")
def routes():
    return {"routes": sorted([str(r) for r in app.url_map.iter_rules()])}


@app.get("/")
def home():
    return render_template("index.html")


# ---------------------- Lichess helpers ----------------------
def verify_lichess_user(username: str) -> str:
    username = (username or "").strip()
    if not username:
        raise LichessUserNotFound("Enter a Lichess username first.")

    url = f"https://lichess.org/api/user/{quote(username, safe='')}"
    try:
        response = requests.get(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "lichess-opening-coach",
            },
            timeout=10,
        )
    except requests.RequestException as exc:
        raise LichessRequestError(
            "Could not reach Lichess to check that player. Try again in a minute."
        ) from exc

    if response.status_code == 404:
        raise LichessUserNotFound(
            f'Lichess player "{username}" was not found. Check the spelling or use the Lichess player database link.'
        )

    if response.status_code == 429:
        raise LichessRequestError("Lichess is rate-limiting requests. Try again in a minute.")

    if response.status_code >= 400:
        raise LichessRequestError(
            f"Lichess returned HTTP {response.status_code} while checking that player."
        )

    try:
        profile = response.json()
    except ValueError:
        profile = {}

    return profile.get("username") or username


def fetch_recent_pgn(username: str, max_games: int = 5) -> str:
    try:
        return lichess.api.user_games(username, max=max_games, format=SINGLE_PGN)
    except Exception as exc:
        raise LichessRequestError(
            "Could not fetch games from Lichess for that player. Try again in a minute."
        ) from exc


def load_games(pgn_text: str):
    f = io.StringIO(pgn_text)
    games = []
    while True:
        g = chess.pgn.read_game(f)
        if g is None:
            break
        games.append(g)
    return games


def is_players_turn(game, username: str, board: chess.Board) -> bool:
    white = (game.headers.get("White") or "").lower()
    black = (game.headers.get("Black") or "").lower()
    u = username.lower()
    return (board.turn == chess.WHITE and white == u) or (board.turn == chess.BLACK and black == u)


def format_time_control(raw: str | None) -> str:
    if not raw:
        return "Unknown"

    raw = raw.strip()
    if raw == "-":
        return "Untimed"

    if "+" in raw:
        base_raw, inc_raw = raw.split("+", 1)
        try:
            base_seconds = int(base_raw)
            increment = int(inc_raw)
            if base_seconds % 60 == 0:
                base = str(base_seconds // 60)
            else:
                base = f"{base_seconds}s"
            return f"{base}+{increment}"
        except ValueError:
            return raw

    if raw.isdigit():
        seconds = int(raw)
        if seconds % 60 == 0:
            return f"{seconds // 60} min"
        return f"{seconds}s"

    return raw


def normalize_time_control(value: str | None) -> str:
    return (value or "").replace(" ", "").strip().lower()


def parse_time_filter(args):
    mode = (args.get("timeMode") or args.get("time_mode") or "all").strip().lower()
    if mode not in {"all", "include", "exclude"}:
        mode = "all"

    raw_controls = args.get("timeControls") or args.get("time_controls") or ""
    controls = [
        normalize_time_control(part)
        for part in raw_controls.replace(";", ",").split(",")
        if normalize_time_control(part)
    ]

    if not controls:
        mode = "all"

    return mode, controls


def game_matches_time_filter(game_context, mode, controls):
    if mode == "all" or not controls:
        return True

    candidates = {
        normalize_time_control(game_context.get("time_control")),
        normalize_time_control(game_context.get("time_control_raw")),
    }
    matches = bool(candidates.intersection(controls))
    return matches if mode == "include" else not matches


def player_game_context(game, username: str):
    white = game.headers.get("White") or "Unknown"
    black = game.headers.get("Black") or "Unknown"
    if white.lower() == username.lower():
        user_color = "White"
        opponent = black
    elif black.lower() == username.lower():
        user_color = "Black"
        opponent = white
    else:
        user_color = "Unknown"
        opponent = f"{white} / {black}"

    time_control_raw = game.headers.get("TimeControl")

    return {
        "white": white,
        "black": black,
        "opponent": opponent,
        "user_color": user_color,
        "result": game.headers.get("Result"),
        "date": game.headers.get("UTCDate") or game.headers.get("Date"),
        "site": game.headers.get("Site"),
        "event": game.headers.get("Event"),
        "time_control": format_time_control(time_control_raw),
        "time_control_raw": time_control_raw,
    }


def game_move_history(game: chess.pgn.Game):
    board = game.board()
    history = [{
        "index": 0,
        "ply": 0,
        "label": "Start",
        "fen": board.fen(),
        "move_number": None,
        "side": None,
        "move_san": None,
        "move_uci": None,
    }]

    for ply, move in enumerate(game.mainline_moves(), start=1):
        side = "White" if board.turn == chess.WHITE else "Black"
        move_number = board.fullmove_number
        move_san = board.san(move)
        move_uci = move.uci()
        board.push(move)
        history.append({
            "index": ply,
            "ply": ply,
            "label": f"{move_number}. {move_san}" if side == "White" else f"{move_number}... {move_san}",
            "fen": board.fen(),
            "move_number": move_number,
            "side": side,
            "move_san": move_san,
            "move_uci": move_uci,
        })

    return history


def clamp_analysis_params(args):
    max_games = int(args.get("max", "10"))
    plies = int(args.get("plies", "12"))
    depth = int(args.get("depth", "10"))
    max_games = max(1, min(max_games, 50))
    plies = max(2, min(plies, 20))
    depth = max(6, min(depth, 14))
    time_mode, time_controls = parse_time_filter(args)
    return max_games, plies, depth, time_mode, time_controls


def fetch_limit_for_filter(max_games, time_mode, time_controls):
    if time_mode == "all" or not time_controls:
        return max_games
    return min(MAX_FILTER_SCAN_GAMES, max(max_games, max_games * 10))


def analyze_opening_mistakes(
    username: str,
    max_games: int,
    plies: int,
    depth: int,
    time_mode: str = "all",
    time_controls=None,
    progress_callback=None,
):
    time_controls = time_controls or []
    username = verify_lichess_user(username)
    if progress_callback:
        progress_callback(
            state="fetching",
            current_game=0,
            total_games=max_games,
            message="Fetching recent Lichess games",
        )
    fetch_limit = fetch_limit_for_filter(max_games, time_mode, time_controls)
    pgn = fetch_recent_pgn(username, max_games=fetch_limit)
    fetched_games = load_games(pgn)
    game_items = []
    scanned_games = 0
    for original_index, game in enumerate(fetched_games, start=1):
        scanned_games += 1
        game_context = player_game_context(game, username)
        if game_matches_time_filter(game_context, time_mode, time_controls):
            game_items.append((original_index, game, game_context))
            if len(game_items) >= max_games:
                break

    games = [item[1] for item in game_items]
    total_games = len(games)
    skipped_games = scanned_games - total_games

    results = []

    if progress_callback:
        if time_mode == "all":
            message = f"Found {total_games} games to analyze"
        else:
            controls_label = ", ".join(time_controls)
            message = f"Matched {total_games} of {scanned_games} scanned games for {time_mode} {controls_label}"
        progress_callback(
            state="filtering",
            current_game=0,
            total_games=total_games,
            message=message,
        )

    if total_games == 0:
        return {
            "username": username,
            "requested_games": max_games,
            "analyzed_games": 0,
            "fetched_games": scanned_games,
            "scanned_games": scanned_games,
            "skipped_games": skipped_games,
            "total_mistakes": 0,
            "recurring_mistake_count": 0,
            "params": {
                "max": max_games,
                "plies": plies,
                "depth": depth,
                "time_mode": time_mode,
                "time_controls": time_controls,
            },
            "top_recurring_mistakes": [],
            "games": [],
        }

    stockfish_path = resolve_stockfish_path()
    if not stockfish_path:
        raise RuntimeError("Stockfish engine not found. Set STOCKFISH_PATH or place stockfish/stockfish.exe in the engine folder.")

    with chess.engine.SimpleEngine.popen_uci(stockfish_path) as engine:
        for game_number, (_, g, game_context) in enumerate(game_items, start=1):
            board = g.board()
            move_history = game_move_history(g)
            game_mistakes = []
            if progress_callback:
                progress_callback(
                    state="analyzing",
                    current_game=game_number - 1,
                    total_games=total_games,
                    message=f"Analyzing game {game_number} of {total_games}",
                    game=f"{game_context['white']} vs {game_context['black']}",
                    time_control=game_context["time_control"],
                )

            for ply, move in enumerate(g.mainline_moves(), start=1):
                if ply > plies:
                    break

                # Who is about to move (the mover)
                players_turn = is_players_turn(g, username, board)
                mover_color = board.turn
                move_number = board.fullmove_number
                move_san = board.san(move)
                fen_before = board.fen()

                # ---- Evaluate BEFORE the move ----
                info_before = first_info(engine.analyse(board, chess.engine.Limit(depth=depth)))
                score_before = info_before["score"]
                eval_before = score_to_pawns(score_before)

                # Best move from BEFORE position
                best_move_uci = get_best_move_uci(info_before, engine, board, depth)
                best_move_san = move_san_from_uci(board, best_move_uci)

                pv_moves = []
                if "pv" in info_before:
                    pv_moves = [m.uci() for m in info_before["pv"][:6]]  # 6 plies (~3 full moves)

                # ---- Apply actual move played ----
                board.push(move)

                # ---- Evaluate AFTER the move ----
                info_after = first_info(engine.analyse(board, chess.engine.Limit(depth=depth)))
                score_after = info_after["score"]
                eval_after = score_to_pawns(score_after)

                # Opponent best reply (after mover played)
                best_reply_uci = get_best_move_uci(info_after, engine, board, depth)
                best_reply_san = move_san_from_uci(board, best_reply_uci)

                # ---- Drop FOR THE MOVER (correct sign for White/Black) ----
                # eval is White POV. If mover is Black, invert.
                drop_white_pov = eval_before - eval_after
                drop_for_mover = drop_white_pov if mover_color == chess.WHITE else -drop_white_pov

                mate_after_n = mate_in(score_after)
                mistake_type = classify_mistake(drop_for_mover, mate_after_n)

                # ---- Opening noise filter (forgiving early) ----
                if ply <= 8 and drop_for_mover < 1.0:
                    mistake_type = "ok"

                # ---- Record only mistakes made by the USER ----
                if players_turn and mistake_type != "ok":
                    game_mistakes.append({
                        "game_number": game_number,
                        "ply": ply,
                        "history_index": ply - 1,
                        "move_number": move_number,
                        "side": "White" if mover_color == chess.WHITE else "Black",
                        "move_uci": move.uci(),
                        "move_san": move_san,
                        "best_move_uci": best_move_uci,
                        "best_move_san": best_move_san,
                        "best_reply_uci": best_reply_uci,
                        "best_reply_san": best_reply_san,
                        "drop_pawns": round(drop_for_mover, 2),
                        "mistake_type": mistake_type,
                        "eval_before": round(eval_before, 2),
                        "eval_after": round(eval_after, 2),
                        "mate_after": mate_after_n,   # e.g., -3 means opponent mates in 3
                        "pv_before": pv_moves,
                        "fen_before": fen_before,
                    })
            eco = g.headers.get("ECO")
            opening_info = best_opening_info(g, eco)

            results.append({
                "game_number": game_number,
                **game_context,
                "eco": opening_info["eco"] or eco,
                "opening": opening_info["label"],
                "opening_name": opening_info["name"],
                "opening_moves": opening_info["moves"],
                "opening_source": opening_info["source"],
                "opening_matched_plies": opening_info["matched_plies"],
                "move_history": move_history,
                "mistakes": game_mistakes,
            })
            if progress_callback:
                progress_callback(
                    state="analyzing",
                    current_game=game_number,
                    total_games=total_games,
                    message=f"Analyzed game {game_number} of {total_games}",
                    game=f"{game_context['white']} vs {game_context['black']}",
                    time_control=game_context["time_control"],
                )

    # ---------------------- Aggregation (recurring mistakes) ----------------------
    if progress_callback:
        progress_callback(
            state="summarizing",
            current_game=total_games,
            total_games=total_games,
            message="Summarizing recurring mistakes",
        )

    agg = {}

    for game in results:
        opening_bucket = game.get("opening") or game.get("eco") or "Unknown"

        for m in game.get("mistakes", []):
            key = (opening_bucket, m["fen_before"], m["move_uci"])

            if key not in agg:
                agg[key] = {
                    "opening": opening_bucket,
                    "eco": game.get("eco"),
                    "opening_name": game.get("opening_name"),
                    "opening_moves": game.get("opening_moves"),
                    "opening_source": game.get("opening_source"),
                    "opening_matched_plies": game.get("opening_matched_plies"),
                    "fen_before": m["fen_before"],
                    "move_uci": m["move_uci"],
                    "count": 0,
                    "drop_sum": 0.0,
                    "types": Counter(),
                    "best_moves": Counter(),
                    "best_replies": Counter(),
                    "opponents": Counter(),
                    "examples": [],
                    "example": m,
                }

            agg[key]["count"] += 1
            agg[key]["drop_sum"] += float(m.get("drop_pawns", 0.0))
            agg[key]["types"][m.get("mistake_type", "unknown")] += 1
            agg[key]["best_moves"][m.get("best_move_uci")] += 1
            agg[key]["best_replies"][m.get("best_reply_uci")] += 1
            agg[key]["opponents"][game.get("opponent")] += 1
            if len(agg[key]["examples"]) < 3:
                agg[key]["examples"].append({
                    "game_number": m.get("game_number"),
                    "white": game.get("white"),
                    "black": game.get("black"),
                    "opponent": game.get("opponent"),
                    "user_color": game.get("user_color"),
                    "result": game.get("result"),
                    "date": game.get("date"),
                    "site": game.get("site"),
                    "event": game.get("event"),
                    "time_control": game.get("time_control"),
                    "time_control_raw": game.get("time_control_raw"),
                    "opening_name": game.get("opening_name"),
                    "opening_moves": game.get("opening_moves"),
                    "opening_source": game.get("opening_source"),
                    "opening_matched_plies": game.get("opening_matched_plies"),
                    "history_index": m.get("history_index"),
                    "move_number": m.get("move_number"),
                    "side": m.get("side"),
                    "move_san": m.get("move_san"),
                    "move_uci": m.get("move_uci"),
                    "best_move_san": m.get("best_move_san"),
                    "best_move_uci": m.get("best_move_uci"),
                    "drop_pawns": m.get("drop_pawns"),
                    "mistake_type": m.get("mistake_type"),
                })

    recurring = []
    for v in agg.values():
        avg_drop = v["drop_sum"] / v["count"]
        common_type = v["types"].most_common(1)[0][0] if v["types"] else None
        recommended = v["best_moves"].most_common(1)[0][0] if v["best_moves"] else None
        best_reply = v["best_replies"].most_common(1)[0][0] if v["best_replies"] else None
        common_opponent = v["opponents"].most_common(1)[0][0] if v["opponents"] else None

        recurring.append({
            "opening": v["opening"],
            "eco": v["eco"],
            "opening_name": v["opening_name"],
            "opening_moves": v["opening_moves"],
            "opening_source": v["opening_source"],
            "opening_matched_plies": v["opening_matched_plies"],
            "fen_before": v["fen_before"],
            "move_uci": v["move_uci"],
            "move_san": v["example"].get("move_san") if v["example"] else None,
            "count": v["count"],
            "avg_drop_pawns": round(avg_drop, 2),
            "mistake_type": common_type,
            "recommended_move_uci": recommended,
            "recommended_move_san": v["example"].get("best_move_san") if v["example"] else None,
            "opponent_best_reply_uci": best_reply,
            "opponent_best_reply_san": v["example"].get("best_reply_san") if v["example"] else None,
            "common_opponent": common_opponent,
            "examples": v["examples"],
            "pv_before": v["example"].get("pv_before") if v["example"] else None,
        })

    recurring.sort(key=lambda x: (x["count"], x["avg_drop_pawns"]), reverse=True)
    top_recurring = recurring[:10]

    total_mistakes = sum(len(game.get("mistakes", [])) for game in results)

    return {
        "username": username,
        "requested_games": max_games,
        "analyzed_games": len(games),
        "fetched_games": scanned_games,
        "scanned_games": scanned_games,
        "skipped_games": skipped_games,
        "total_mistakes": total_mistakes,
        "recurring_mistake_count": len(recurring),
        "params": {
            "max": max_games,
            "plies": plies,
            "depth": depth,
            "time_mode": time_mode,
            "time_controls": time_controls,
        },
        "top_recurring_mistakes": top_recurring,
        "games": results,
    }


# ---------------------- Main endpoints ----------------------
@app.get("/lichess/<username>/opening_mistakes")
def opening_mistakes(username: str):
    max_games, plies, depth, time_mode, time_controls = clamp_analysis_params(request.args)
    result = analyze_opening_mistakes(username, max_games, plies, depth, time_mode, time_controls)
    return jsonify(result)


@app.post("/lichess/<username>/opening_mistakes/jobs")
def start_opening_mistakes_job(username: str):
    cleanup_jobs()
    max_games, plies, depth, time_mode, time_controls = clamp_analysis_params(request.args)
    job_id = uuid.uuid4().hex
    now = time.time()
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "state": "queued",
            "current_game": 0,
            "total_games": max_games,
            "message": "Queued analysis",
            "progress_percent": 0,
            "time_mode": time_mode,
            "time_controls": time_controls,
            "created_at": now,
            "updated_at": now,
        }

    def run_job():
        def update_progress(**payload):
            current = int(payload.get("current_game") or 0)
            total = max(1, int(payload.get("total_games") or max_games))
            percent = min(99, int((current / total) * 100))
            set_job_status(job_id, progress_percent=percent, **payload)

        try:
            result = analyze_opening_mistakes(
                username,
                max_games,
                plies,
                depth,
                time_mode,
                time_controls,
                update_progress,
            )
            set_job_status(
                job_id,
                state="complete",
                current_game=result["analyzed_games"],
                total_games=result["analyzed_games"],
                message="Analysis complete",
                progress_percent=100,
                result=result,
            )
        except (LichessUserNotFound, LichessRequestError) as exc:
            set_job_status(job_id, state="error", error=str(exc), progress_percent=100)
        except Exception as exc:
            app.logger.exception("Analysis job failed")
            set_job_status(job_id, state="error", error=str(exc) or "Analysis failed", progress_percent=100)

    threading.Thread(target=run_job, daemon=True).start()
    return jsonify({"job_id": job_id})


@app.get("/lichess/jobs/<job_id>")
def opening_mistakes_job_status(job_id: str):
    cleanup_jobs()
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return jsonify({"error": "Analysis job not found. Start a new analysis."}), 404
        snapshot = dict(job)

    snapshot.pop("created_at", None)
    snapshot.pop("updated_at", None)
    return jsonify(snapshot)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    host = os.environ.get("FLASK_HOST", "127.0.0.1")
    app.run(host=host, port=port, debug=debug)
