import chess
import chess.engine

def eval_cp(engine: chess.engine.SimpleEngine, board: chess.Board, depth: int = 10) -> int:
    """Return evaluation in centipawns from White's POV."""
    info = engine.analyse(board, chess.engine.Limit(depth=depth))
    score = info["score"].pov(chess.WHITE)
    return score.score(mate_score=100000)  # cp; large value if mate

def best_move_uci(engine: chess.engine.SimpleEngine, board: chess.Board, depth: int = 10) -> str:
    """Return best move in UCI string (e.g., e2e4)."""
    result = engine.play(board, chess.engine.Limit(depth=depth))
    return result.move.uci()
