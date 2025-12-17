import chess
import chess.engine

def _is_players_turn(game, username: str, board: chess.Board) -> bool:
    white = (game.headers.get("White") or "").lower()
    black = (game.headers.get("Black") or "").lower()
    u = username.lower()
    return (board.turn == chess.WHITE and white == u) or (board.turn == chess.BLACK and black == u)

def classify_drop(drop_pawns: float) -> str:
    if drop_pawns >= 1.5:
        return "blunder"
    if drop_pawns >= 0.7:
        return "mistake"
    if drop_pawns >= 0.3:
        return "inaccuracy"
    return "ok"

def find_opening_mistakes(game, username: str, engine: chess.engine.SimpleEngine, plies: int = 10, depth: int = 10):
    board = game.board()
    out = []

    for ply, move in enumerate(game.mainline_moves(), start=1):
        if ply > plies:
            break

        players_turn = _is_players_turn(game, username, board)
        fen_before = board.fen()

        # Evaluate before
        info_before = engine.analyse(board, chess.engine.Limit(depth=depth))
        before_cp = info_before["score"].pov(chess.WHITE).score(mate_score=100000)

        # Best move suggestion (from the same position)
        best = engine.play(board, chess.engine.Limit(depth=depth)).move
        best_uci = best.uci()

        # Play actual move
        board.push(move)

        # Evaluate after
        info_after = engine.analyse(board, chess.engine.Limit(depth=depth))
        after_cp = info_after["score"].pov(chess.WHITE).score(mate_score=100000)

        if players_turn:
            drop_pawns = (before_cp - after_cp) / 100.0  # positive => worse for White POV
            label = classify_drop(drop_pawns)
            if label != "ok":
                out.append({
                    "ply": ply,
                    "move_uci": move.uci(),
                    "drop_pawns": round(drop_pawns, 2),
                    "label": label,
                    "best_move_uci": best_uci,
                    "fen_before": fen_before,
                })

    return out
