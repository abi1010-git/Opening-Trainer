import lichess.api
from lichess.format import SINGLE_PGN

def fetch_recent_pgn(username: str, max_games: int = 25) -> str:
    return lichess.api.user_games(username, max=max_games, format=SINGLE_PGN)