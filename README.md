# Repeated Mistakes Made in Chess Openings(FROM LICHESS.ORG GAMES)

Repeated Mistakes Made in Chess Openings is a Flask web app that reviews a Lichess user's recent games, focuses on the opening phase, and highlights recurring mistakes with Stockfish recommendations. The interface also shows a chessboard with the played move and the suggested move marked as arrows.

Live App : https://lichess-opening-trainer.onrender.com

## Features

- Fetch recent public games from a Lichess username.
- Analyze the first few plies with Stockfish.
- Detect opening mistakes, inaccuracies, blunders, and tactical mate threats.
- Group recurring mistakes by opening, position, and played move.
- Show the played move and recommended move on an interactive board.
- Run locally with Python or as a Docker container.

## Project Structure

```text
lichess-opening-coach/
  app.py                 Flask app and analysis endpoint
  Dockerfile             Docker image setup with Stockfish
  requirements.txt       Python dependencies
  README.md              Project instructions
  data/
    openings.csv         ECO opening names and move lines
  engine/
    stockfish.exe        Optional local Windows Stockfish binary
  src/
    *.py                 Earlier helper modules for PGN and engine analysis
  static/
    app.js               Browser-side interaction
    style.css            Page styling
  templates/
    index.html           Main app page
```

## Stockfish

The app needs a Stockfish executable. It looks in this order:

- `STOCKFISH_PATH` environment variable.
- `engine/stockfish.exe`.
- `engine/stockfish`.
- `stockfish` on your system path.
- common Linux install paths such as `/usr/games/stockfish`.

The Docker image installs Stockfish automatically, so you do not need to commit a binary to GitHub.

## Run Locally

From the project folder:

```powershell
cd C:\Users\abhia\lichess-opening-coach
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

If Stockfish is somewhere else on your computer, set the path before starting the app:

```powershell
$env:STOCKFISH_PATH = "C:\path\to\stockfish.exe"
python app.py
```

## Run With Docker

Make sure Docker Desktop is running first.

Build the image:

```powershell
docker build -t lichess-opening-coach .
```

Run the app:

```powershell
docker run --rm -p 5000:5000 lichess-opening-coach
```

Open:

```text
http://localhost:5000
```

## Deploy As A Public App

A simple deployment path is Render using the Dockerfile in this repository.

1. Commit and push this project to GitHub.
2. Go to `https://render.com`.
3. Create a new Web Service from this repository:

```text
abi1010-git/Opening-Trainer
```

4. Choose Docker as the runtime.
5. Use the default Dockerfile.
6. Set the health check path to:

```text
/health
```

7. Deploy the service.

Render will build the Docker image, install Python dependencies and Stockfish, then run the Flask app through Gunicorn.

## Save Changes To GitHub

```powershell
git add .
git commit -m "Update Lichess opening coach deployment setup"
git push
```


## Personal review sessions

After analyzing games, choose **Review my mistakes** to practice up to five saved
positions. Positions with fewer previous attempts come first, with larger evaluation
drops breaking ties. A first-try correct answer completes a position; wrong answers
and revealed answers leave it available for a later session. **Next position** advances
after solving or revealing a position. Completed sessions show a first-try score.

The review queue and an unfinished session are saved in this browser's local storage.
Reload the app and choose **Review my mistakes** to resume. This is device/browser
specific, does not sync between devices, and can be removed by clearing site data.
Analyzing another username starts that player's queue instead. Storage failures show
a notice while allowing practice to continue.

Practice accepts legal moves only; select a promotion piece when a promotion is
available. The current drill checks the engine's recommended move, rather than
accepting every move with a similar evaluation. Recurring summaries include only
mistakes occurring at least twice in the analysis sample.

### Regression checks

```bash
python -m unittest discover -s tests -v
node tests/failure-state.cjs
node tests/review-session.cjs
```

## Opening identification

Opening names and ECO codes come from the CC0 Lichess chess-openings database:
https://github.com/lichess-org/chess-openings (revision
`a6189a30dc273ccb21fc2536a9a2fefd5592a67a`, 3,865 lines).
The bundled CSV preserves the published names and legal move sequences.
Identification uses the longest exact played prefix, then recognizes later book
positions reached by transposition. Position comparisons include side to move,
castling rights and legal en-passant rights. Fullmove counters are ignored.
An unverified ECO tag cannot override a matching played line. If no book match
exists, a supplied opening header is labeled as a header source; otherwise the
opening is unknown. A label describes the deepest recognized book position, not
proof that later moves remain theory. Different opening databases can use different
ECO boundaries or names for the same position.
