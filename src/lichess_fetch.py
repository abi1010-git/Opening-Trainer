from urllib.parse import quote

import requests


class LichessUserNotFound(ValueError):
    pass


class LichessRequestError(RuntimeError):
    pass

def fetch_recent_pgn(username: str, max_games: int = 25) -> str:
    """Export PGN directly, preserving actionable upstream failure information."""
    username = (username or "").strip()
    if not username:
        raise LichessUserNotFound("Enter a Lichess username first.")
    try:
        response = requests.get(
            f"https://lichess.org/api/games/user/{quote(username, safe='')}",
            params={"max": max_games, "opening": "true", "clocks": "false", "evals": "false"},
            headers={"Accept": "application/x-chess-pgn", "User-Agent": "lichess-opening-coach"},
            timeout=(10, 60),
        )
    except requests.Timeout as exc:
        raise LichessRequestError("Lichess took too long to export games. Try fewer games or retry later.") from exc
    except requests.RequestException as exc:
        raise LichessRequestError("Could not connect to Lichess to export games. Please retry later.") from exc

    if response.status_code == 404:
        raise LichessUserNotFound(f'Lichess player "{username}" was not found. Check the spelling.')
    if response.status_code == 429:
        raise LichessRequestError("Lichess is rate-limiting game exports. Wait at least one minute before retrying.")
    if response.status_code >= 400:
        raise LichessRequestError(f"Lichess game export returned HTTP {response.status_code}. Please retry later.")
    pgn = response.text
    # An empty export is valid for a player without games; HTML/JSON is not PGN.
    if pgn.strip() and not pgn.lstrip().startswith("["):
        raise LichessRequestError("Lichess returned an unexpected game-export response. Please retry later.")
    return pgn
