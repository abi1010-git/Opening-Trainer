# Opening Trainer

**Find the opening mistakes you keep repeating, and train until they're gone.**

### ▶ [Open Opening Trainer](https://abi1010-git.github.io/Opening-Trainer/)

Works with **Lichess** and **Chess.com**. Free, no account, nothing to install.

[![CI](https://github.com/abi1010-git/Opening-Trainer/actions/workflows/ci.yml/badge.svg)](https://github.com/abi1010-git/Opening-Trainer/actions/workflows/ci.yml)

---

## Why I use it

I kept losing games before they really got going, and when I looked back, it was often the *same* position going wrong in the *same* way. The game review on chess sites showed me one game at a time, so I never noticed the pattern. Opening courses taught me lines I rarely reached in my own games.

So I built this to look at all my recent games at once and answer one question: **what am I getting wrong over and over?** Then it makes me practise exactly those positions until I play them right.

## What it does for you

**Finds your repeated mistakes.** It checks the opening of every game you choose with Stockfish, one of the strongest chess engines, and groups identical mistakes together. Instead of "you blundered in game 14", you see *"you played 5…gxf6 in 3 different games, and 5…exf6 is better."*

**Explains why, in plain English.** For each mistake you can replay the game on a board and read what actually goes wrong: *"Nc6 loses your knight on f6: exf6 takes it right away"*, *"allows Nc7+, which attacks your king and rook at once"*, or *"no immediate tactic, it's a positional error"*. The explanations come from replaying the engine's lines, not from an AI chatbot, so they don't make things up.

**Shows what players at your rating play.** Next to each mistake you see how often players at your level choose each move in that position and how it scores, from the Lichess opening database. It points out common traps (*"35% of players at your level play this, and it scores only 41%"*) and strong moves your opponents rarely expect.

**Maps the openings you really play.** Your **Repertoire** is a move tree built from your own games, not from a book. Every branch shows how often you reach it and how you score there. Lines you play a lot and lose in are marked **weak**, so you know where to study.

**Trains you until it sticks.** Every mistake becomes a drill. You see the position and find the right move. Positions you get wrong come back in 10 minutes. Positions you get right come back after 1 day, then 3 days, then about a week, and so on, so you only review what you're close to forgetting. If you find a different move that's just as good, it counts.

**Checks that the training worked.** Each time you analyse new games, it looks for positions you've drilled and checks what you actually played. Every drilled position is marked **Fixed in real games**, **Still repeating** or **Not reached yet**, so you know your practice is paying off.

**Preps you for your next opponent.** Enter their username in **Scout**. It analyses their recent games, finds the mistakes *they* repeat, and checks which of those positions your own openings already reach, with the line to get there.

**Shows how each opening is going.** Your score, mistakes per game, and how early your first mistake usually comes, for every opening you play as White and as Black.

## How to use it

1. **Open the [app](https://abi1010-git.github.io/Opening-Trainer/)** and choose **Lichess** or **Chess.com**.
2. **Enter your username**, pick how many recent games to check, and optionally choose time controls (for example, only blitz and rapid).
3. **Click "Analyze my openings".** It usually takes under a minute for 25 games.
4. **Start with the Overview.** The top of the page shows the mistakes you repeat most. Click one to see it on the board.
5. **Go to Train** and work through your due positions. A badge on the Train tab shows how many are waiting.
6. **Before a game,** open **Scout** and enter your opponent's username to see where they tend to go wrong.
7. **Come back every few days.** Do your due drills, and re-analyse after you've played more games. Your training progress is kept.

### Tips

- **25 to 50 games** is the sweet spot. Fewer games means fewer repeats to find.
- **Pick the time controls you care about.** Bullet openings are often different from rapid ones.
- **Limit it to recent games** (last month, 3 months or year) if your openings have changed.
- **Watch for "few games".** A score from under 5 games can swing a lot, so the app labels it.
- **Re-running is fast.** Positions already checked are remembered, so a second analysis mostly only checks new games.

## FAQ

**Is it really free? Do I need an account?**
Yes, and no. There's nothing to sign up for. You only type a public username.

**Where does my data go?**
Your games are downloaded from the public Lichess or Chess.com APIs straight into your browser. The analysis runs on your own computer, and your report and drill progress are saved only in your browser. The only thing sent anywhere is a board position, to the Lichess opening database, when you open a mistake to see what players at your rating play. No username or personal data is sent with it.

**How much of each game is checked?**
Each game is checked until **6 moves after it leaves known opening theory**, because that's where most opening mistakes happen. That's always at least the first 8 moves and at most move 15 by default. You can raise the limit under **Advanced**.

**Why did it flag a move that's "book"?**
Stockfish sometimes disagrees with popular theory. Moves that only lose a little in the first few moves are ignored, so what you see is usually worth a look, but use your judgement.

**Does it work on my phone?**
Yes. Analysis is slower on phones than on a laptop, so start with fewer games.

**Which games are skipped?**
Variants (Chess960, crazyhouse, and so on) and games that started from a custom position.

**My drills disappeared.**
Drills are saved per browser and per username. Using a different browser or device, or clearing your browser data, starts fresh.

---

## For developers

Opening Trainer is a static React app with no backend. Stockfish 19 runs in the browser as WebAssembly, in a pool of Web Workers (one per spare CPU core). Engine results are cached in IndexedDB, and drill schedules use a simplified SM-2 spaced-repetition algorithm.

A few implementation details:

- **Adaptive opening length:** each game is analysed until 6 moves past its last opening-book position (between 8 and 15 moves), instead of a fixed move count.
- **Each position is evaluated once:** the evaluation after one move is reused as the evaluation before the next.
- **Mistakes are graded by drop in winning chances** (the same curve Lichess uses), not raw pawns, so a move that keeps a won position won isn't flagged.
- **Openings are named by position, not move order,** so transpositions get the right name.
- **Rule-based explanations:** the engine's refutation line is replayed with chess.js to detect lost material, forks and missed wins, and a claim is only made when the engine's evaluation agrees.
- **Closed feedback loop:** drilled positions are matched against later real games to measure whether training carried over.

**Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, chess.js, Chessground, Stockfish 19 (WASM), Vitest, GitHub Actions and Pages.

### Run it locally

```bash
cd web
npm install      # also sets up the Stockfish files and the opening book
npm run dev      # http://localhost:5173
npm test
```

Pushing to `main` runs the tests and deploys to GitHub Pages automatically.

### Project layout

```text
web/src/lib/          Game import, engine, analysis, openings, spaced repetition, repertoire
web/src/components/   Screens: Home, Overview, Mistakes, Repertoire, Train
web/test/             Unit tests
data/openings.csv     Opening names (ECO)
app.py, src/          The original Flask version (Lichess only), kept for reference
```

## Author

Made by **Abhijith Aravind** ([@abi1010-git](https://github.com/abi1010-git)). Found a bug or have an idea? [Open an issue](https://github.com/abi1010-git/Opening-Trainer/issues).
