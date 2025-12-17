import io
import chess.pgn

def load_games(pgn_text: str):
    f = io.StringIO(pgn_text)
    games = []
    while True:
        g = chess.pgn.read_game(f)
        if g is None:
            break
        games.append(g)
    return games
