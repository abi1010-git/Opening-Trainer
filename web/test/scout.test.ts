import { describe, expect, it } from 'vitest';
import { openingChoices, steerTargets } from '../src/lib/scout';
import { positionsFor } from '../src/lib/analysis';
import { positionKey } from '../src/lib/format';
import type { AnalyzedGame, Leak } from '../src/lib/types';

const g = (id: string, color: 'white' | 'black', moves: string[], outcome: AnalyzedGame['outcome'] = 'win') =>
  ({ id, userColor: color, moves, outcome, mistakes: [], analyzedPlies: 16 }) as unknown as AnalyzedGame;

const leakAt = (moves: string[], color: 'white' | 'black', count: number, id: string): Leak =>
  ({ id, positionKey: positionKey(positionsFor(moves, moves.length).fens[moves.length]), color, count, severity: 'mistake', lineBefore: moves }) as unknown as Leak;

describe('steerTargets', () => {
  it('ranks opponent mistakes your repertoire reaches above ones it does not', () => {
    const you = [g('a', 'white', ['e4', 'c5', 'Nf3']), g('b', 'white', ['e4', 'c5', 'Nf3'])];
    // Opponent (Black) goes wrong after 1.e4 c5 2.Nf3 — a position you reach as White.
    const reachable = leakAt(['e4', 'c5', 'Nf3'], 'black', 1, 'reach');
    // Opponent goes wrong after 1.d4 — you never play that.
    const unreachable = leakAt(['d4'], 'black', 3, 'far');
    const t = steerTargets(you, [unreachable, reachable]);
    expect(t[0].leak.id).toBe('reach');
    expect(t[0].yourColor).toBe('white');
    expect(t[0].yourGames).toBe(2);
    expect(t[1].yourGames).toBe(0);
  });
});

describe('openingChoices', () => {
  it('summarises first moves and replies with scores', () => {
    const games = [g('1', 'white', ['e4', 'e5'], 'win'), g('2', 'white', ['e4', 'c5'], 'loss'), g('3', 'black', ['d4', 'Nf6'], 'draw')];
    expect(openingChoices(games, 'white')).toEqual([{ line: '1.e4', games: 2, score: 0.5 }]);
    expect(openingChoices(games, 'black')).toEqual([{ line: '1.d4 Nf6', games: 1, score: 0.5 }]);
  });
});
