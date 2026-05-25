# Repeated Mistakes Made in Chess Openings

Repeated Mistakes Made in Chess Openings is a Flask web app that reviews a Lichess user's recent games, focuses on the opening phase, and highlights recurring mistakes with Stockfish recommendations. The interface shows a chessboard with the played move and the suggested move marked as arrows.

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
