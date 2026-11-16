import { describe, expect, it } from 'vitest';
import { analyzeGame, classifyMove, evalToPawns, findLeaks, openingCutoff, openingStats, positionsFor, type Evaluator } from '../src/lib/analysis';
import type { OpeningBook } from '../src/lib/openings';
import { parseInfoLine } from '../src/lib/engine';
import { positionKey } from '../src/lib/format';
import type { GameRecord, PositionEval } from '../src/lib/types';

describe('classifyMove', () => {
  it('ignores small engine preferences early in the opening', () => {
    expect(classifyMove(0.3, -0.5, 4)).toBeNull();
  });

  it('flags a real blunder', () => {
    expect(classifyMove(0.2, -2.5, 12)).toBe('blunder');
  });

  it('does not flag moves that keep a winning position winning', () => {
    // +8 → +6 is a big pawn drop, but the game is still completely won.
    expect(classifyMove(8, 6, 14)).toBeNull();
  });

  it('grades by winning chances', () => {
    expect(classifyMove(0, -0.6, 12)).toBe('inaccuracy');
    expect(classifyMove(0, -1.4, 12)).toBe('mistake');
  });
});

describe('parseInfoLine', () => {
  it('reads centipawn scores and the PV', () => {
    const info = parseInfoLine('info depth 12 seldepth 18 multipv 1 score cp -34 nodes 1000 nps 1 time 5 pv e7e5 g1f3');
    expect(info).toEqual({ depth: 12, cp: -34, pv: ['e7e5', 'g1f3'] });
  });

  it('reads mate scores', () => {
    expect(parseInfoLine('info depth 5 score mate -2 pv h5f7')).toEqual({ depth: 5, mate: -2, pv: ['h5f7'] });
  });

  it('skips bound-only lines and non-score lines', () => {
    expect(parseInfoLine('info depth 10 score cp 20 lowerbound pv e2e4')).toBeNull();
    expect(parseInfoLine('info string NNUE enabled')).toBeNull();
  });
});

describe('evalToPawns', () => {
  it('maps mates to ±100', () => {
    expect(evalToPawns({ mate: 3, pv: [], depth: 1 })).toBe(100);
    expect(evalToPawns({ mate: -1, pv: [], depth: 1 })).toBe(-100);
    expect(evalToPawns({ cp: 150, pv: [], depth: 1 })).toBe(1.5);
  });
});

// A fake engine: everything is equal, except after the user's bad move.
function fakeEvaluator(bad: Record<string, PositionEval>): Evaluator & { calls: number } {
  return {
    calls: 0,
    async evaluate(fen) {
      this.calls++;
      return bad[positionKey(fen)] ?? { cp: 0, pv: ['g1f3'], depth: 10 };
    },
  };
}

function game(id: string, moves: string[], userColor: 'white' | 'black', outcome: GameRecord['outcome'] = 'loss'): GameRecord {
  return {
    id,
    site: 'lichess',
    url: `https://lichess.org/${id}`,
    white: userColor === 'white' ? 'me' : 'them',
    black: userColor === 'black' ? 'me' : 'them',
    userColor,
    opponent: 'them',
    outcome,
    timeControl: '3+0',
    speed: 'blitz',
    date: new Date(0).toISOString(),
    moves,
  };
}

describe('analyzeGame + findLeaks', () => {
  // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nd4? (we pretend Nd4 drops two pawns for Black)
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5'];
  const afterNd4 = positionKey(positionsFor(moves, 6).fens[6]);
  const beforeNd4 = positionKey(positionsFor(moves, 5).fens[5]);
  const evals = {
    [beforeNd4]: { cp: 20, pv: ['g8f6', 'd2d3'], depth: 10 },
    [afterNd4]: { cp: 250, pv: ['f3e5'], depth: 10 },
  };

  it('finds the user mistake and the better move', async () => {
    const result = await analyzeGame(game('a', moves, 'black'), {}, fakeEvaluator(evals), 10, 10);
    expect(result.mistakes).toHaveLength(1);
    const m = result.mistakes[0];
    expect(m.playedSan).toBe('Nd4');
    expect(m.bestSan).toBe('Nf6');
    expect(m.replySan).toBe('Nxe5');
    expect(m.color).toBe('black');
    expect(m.moveNumber).toBe(3);
    expect(m.severity).toBe('blunder');
  });

  it("doesn't blame the user for the opponent's moves", async () => {
    const result = await analyzeGame(game('b', moves, 'white'), {}, fakeEvaluator(evals), 10, 10);
    expect(result.mistakes).toHaveLength(0);
  });

  it('evaluates each position only once', async () => {
    const ev = fakeEvaluator(evals);
    await analyzeGame(game('c', moves, 'black'), {}, ev, 6, 10);
    // Black moves at plies 2, 4, 6 → positions 1..6 = 6 evaluations (not 2 per move).
    expect(ev.calls).toBe(6);
  });

  it('groups the same mistake across games into one leak', async () => {
    const ev = fakeEvaluator(evals);
    const games = await Promise.all([
      analyzeGame(game('g1', moves, 'black', 'loss'), {}, ev, 10, 10),
      analyzeGame(game('g2', moves, 'black', 'draw'), {}, ev, 10, 10),
    ]);
    const leaks = findLeaks(games);
    expect(leaks).toHaveLength(1);
    expect(leaks[0].count).toBe(2);
    expect(leaks[0].scoreInGames).toBe(0.25);
    expect(openingStats(games)[0]).toMatchObject({ games: 2, losses: 1, draws: 1, mistakes: 2 });
  });
});

describe('openingCutoff', () => {
  it('checks 6 moves past the end of book theory', () => {
    expect(openingCutoff(10, 30)).toBe(22);
  });

  it('always checks at least 8 moves, even if the game left theory immediately', () => {
    expect(openingCutoff(0, 30)).toBe(16);
    expect(openingCutoff(2, 30)).toBe(16);
  });

  it('never goes past the maximum', () => {
    expect(openingCutoff(28, 30)).toBe(30);
  });

  it('respects a maximum below the usual minimum', () => {
    expect(openingCutoff(0, 10)).toBe(10);
  });

  it('analyses deeper when the game follows a long book line', async () => {
    const moves = ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be3', 'e5', 'Nb3', 'Be6', 'f3', 'Be7', 'Qd2', 'O-O', 'O-O-O', 'Nbd7', 'g4', 'b5', 'g5', 'b4', 'Ne2', 'Nh5', 'Ng3', 'a5', 'Nxh5', 'Bxh5'];
    const book: OpeningBook = { [positionKey(positionsFor(moves, 10).fens[10])]: ['B90', 'Sicilian Defense: Najdorf Variation', 10, ''] };
    const ev = fakeEvaluator({});
    const inBook = await analyzeGame(game('n', moves, 'white'), book, ev, 40, 10);
    const offBook = await analyzeGame(game('o', moves, 'white'), {}, ev, 40, 10);
    expect(inBook.analyzedPlies).toBe(22);
    expect(offBook.analyzedPlies).toBe(16);
  });
});
