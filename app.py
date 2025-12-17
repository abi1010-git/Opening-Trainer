from collections import Counter
from flask import Flask, jsonify, request, render_template
import chess
import chess.pgn
import chess.engine
import io
import lichess.api
from lichess.format import SINGLE_PGN
import csv
import os

STOCKFISH_PATH = "engine/stockfish.exe"

app = Flask(__name__)


# ---------------------- Engine helpers ----------------------
def load_eco_candidates(path="data/openings.csv"):
    """
    Returns dict: ECO -> list of {"name": str, "moves": str}
    CSV headers: ECO,name,moves
    """
    out = {}
    abs_path = os.path.join(os.path.dirname(__file__), path)
    if not os.path.exists(abs_path):
        print("ECO CSV not found:", abs_path)
        return out

    with open(abs_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            eco = (row.get("ECO") or "").strip()
            name = (row.get("name") or "").strip()
            moves = (row.get("moves") or "").strip()
            if not eco or not name:
                continue
            out.setdefault(eco, []).append({"name": name, "moves": moves})
    print(f"Loaded ECO candidates for {len(out)} codes")
    return out

ECO_CANDIDATES = load_eco_candidates()

def first_info(info):
    # python-chess may return a dict OR a list (multipv-style)
    return info[0] if isinstance(info, list) else info

def load_eco_map(path="data/openings.csv"):
    """
    Builds ECO -> opening name from your CSV (headers: ECO, name, moves).
    Many rows share the same ECO (variations). We keep the FIRST name we see,
    which is usually the canonical umbrella name (better than picking shortest).
    """
    import csv, os

    eco_map = {}
    abs_path = os.path.join(os.path.dirname(__file__), path)

    if not os.path.exists(abs_path):
        print("ECO CSV not found:", abs_path)
        return eco_map

    with open(abs_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            eco = (row.get("ECO") or "").strip()
            name = (row.get("name") or "").strip()
            if not eco or not name:
                continue

            # First wins (canonical)
            if eco not in eco_map:
                eco_map[eco] = name

    print(f"Loaded {len(eco_map)} ECO codes from {abs_path}")
    return eco_map


ECO_MAP = load_eco_map()



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

def best_opening_name(game: chess.pgn.Game, eco: str) -> str:
    opening_hdr = game.headers.get("Opening")
    if opening_hdr:
        return opening_hdr

    cands = ECO_CANDIDATES.get(eco) or []
    if not cands:
        return eco or "Unknown"

    prefix = game_prefix_san(game, max_fullmoves=6)

    def common_prefix_len(a: str, b: str) -> int:
        n = min(len(a), len(b))
        i = 0
        while i < n and a[i] == b[i]:
            i += 1
        return i

    best = None
    best_len = -1
    for c in cands:
        mv = c.get("moves") or ""
        score = common_prefix_len(prefix, mv)
        if score > best_len:
            best_len = score
            best = c

    if best_len <= 0:
        return f"{eco} (Irregular / Transposition)"

    return best["name"]



# ---------------------- Basic routes ----------------------
@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/routes")
def routes():
    return {"routes": sorted([str(r) for r in app.url_map.iter_rules()])}


@app.get("/")
def home():
    return render_template("index.html")


# ---------------------- Lichess helpers ----------------------
def fetch_recent_pgn(username: str, max_games: int = 5) -> str:
    return lichess.api.user_games(username, max=max_games, format=SINGLE_PGN)


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


# ---------------------- Main endpoint ----------------------
@app.get("/lichess/<username>/opening_mistakes")
def opening_mistakes(username: str):
    max_games = int(request.args.get("max", "10"))
    plies = int(request.args.get("plies", "12"))
    depth = int(request.args.get("depth", "10"))

    # Keep things reasonable so it runs fast
    max_games = max(1, min(max_games, 50))
    plies = max(2, min(plies, 20))
    depth = max(6, min(depth, 14))

    pgn = fetch_recent_pgn(username, max_games=max_games)
    games = load_games(pgn)

    results = []

    with chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH) as engine:
        for g in games:
            board = g.board()
            game_mistakes = []

            for ply, move in enumerate(g.mainline_moves(), start=1):
                if ply > plies:
                    break

                # Who is about to move (the mover)
                players_turn = is_players_turn(g, username, board)
                mover_color = board.turn
                fen_before = board.fen()

                # ---- Evaluate BEFORE the move ----
                info_before = first_info(engine.analyse(board, chess.engine.Limit(depth=depth)))
                score_before = info_before["score"]
                eval_before = score_to_pawns(score_before)

                # Best move from BEFORE position
                best_move_obj = engine.play(board, chess.engine.Limit(depth=depth)).move
                best_move_uci = best_move_obj.uci()

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
                best_reply_obj = engine.play(board, chess.engine.Limit(depth=depth)).move
                best_reply_uci = best_reply_obj.uci()

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
                        "ply": ply,
                        "move_uci": move.uci(),
                        "best_move_uci": best_move_uci,
                        "best_reply_uci": best_reply_uci,
                        "drop_pawns": round(drop_for_mover, 2),
                        "mistake_type": mistake_type,
                        "eval_before": round(eval_before, 2),
                        "eval_after": round(eval_after, 2),
                        "mate_after": mate_after_n,   # e.g., -3 means opponent mates in 3
                        "pv_before": pv_moves,
                        "fen_before": fen_before,
                    })
            eco = g.headers.get("ECO")
            opening = best_opening_name(g, eco)

            results.append({
                "white": g.headers.get("White"),
                "black": g.headers.get("Black"),
                "result": g.headers.get("Result"),
                "eco": eco,
                "opening": opening,
                "mistakes": game_mistakes,
            })

    # ---------------------- Aggregation (recurring mistakes) ----------------------
    agg = {}

    for game in results:
        opening_bucket = game.get("opening") or game.get("eco") or "Unknown"

        for m in game.get("mistakes", []):
            key = (opening_bucket, m["fen_before"], m["move_uci"])

            if key not in agg:
                agg[key] = {
                    "opening": opening_bucket,
                    "eco": game.get("eco"),
                    "fen_before": m["fen_before"],
                    "move_uci": m["move_uci"],
                    "count": 0,
                    "drop_sum": 0.0,
                    "types": Counter(),
                    "best_moves": Counter(),
                    "best_replies": Counter(),
                    "example": m,
                }

            agg[key]["count"] += 1
            agg[key]["drop_sum"] += float(m.get("drop_pawns", 0.0))
            agg[key]["types"][m.get("mistake_type", "unknown")] += 1
            agg[key]["best_moves"][m.get("best_move_uci")] += 1
            agg[key]["best_replies"][m.get("best_reply_uci")] += 1

    recurring = []
    for v in agg.values():
        avg_drop = v["drop_sum"] / v["count"]
        common_type = v["types"].most_common(1)[0][0] if v["types"] else None
        recommended = v["best_moves"].most_common(1)[0][0] if v["best_moves"] else None
        best_reply = v["best_replies"].most_common(1)[0][0] if v["best_replies"] else None

        recurring.append({
            "opening": v["opening"],
            "eco": v["eco"],
            "fen_before": v["fen_before"],
            "move_uci": v["move_uci"],
            "count": v["count"],
            "avg_drop_pawns": round(avg_drop, 2),
            "mistake_type": common_type,
            "recommended_move_uci": recommended,
            "opponent_best_reply_uci": best_reply,
            "pv_before": v["example"].get("pv_before") if v["example"] else None,
        })

    recurring.sort(key=lambda x: (x["count"], x["avg_drop_pawns"]), reverse=True)
    top_recurring = recurring[:10]

    return jsonify({
        "username": username,
        "analyzed_games": len(games),
        "params": {"max": max_games, "plies": plies, "depth": depth},
        "top_recurring_mistakes": top_recurring,
        "games": results,
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
