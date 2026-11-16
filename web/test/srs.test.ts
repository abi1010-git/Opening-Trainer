import { describe, expect, it } from 'vitest';
import { cardsFromLeaks, dueCards, review } from '../src/lib/srs';
import { buildRepertoire, nodeScore, weakLines } from '../src/lib/repertoire';
import type { AnalyzedGame, Leak } from '../src/lib/types';

const DAY = 86400000;

function leak(partial: Partial<Leak>): Leak {
  return {
    id: 'k|e7e5',
    opening: 'Test Opening',
    eco: null,
    color: 'black',
    fenBefore: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    positionKey: 'k',
    playedSan: 'f6',
    playedUci: 'f7f6',
    bestSan: 'e5',
    bestUci: 'e7e5',
    bestLineSan: ['e5'],
    replySan: null,
    count: 1,
    avgDropPawns: 1,
    severity: 'mistake',
    gameIds: ['g'],
    moveNumber: 1,
    scoreInGames: 0,
    ...partial,
  };
}

describe('spaced repetition', () => {
  it('makes one card per position and merges the wrong moves played there', () => {
    const cards = cardsFromLeaks([leak({ count: 2 }), leak({ id: 'k|g7g5', playedSan: 'g5', playedUci: 'g7g5', count: 1 })], {}, 0);
    expect(Object.keys(cards)).toEqual(['k']);
    expect(cards.k.playedSan).toEqual(['f6', 'g5']);
    expect(cards.k.timesPlayed).toBe(3);
    expect(dueCards(cards, 0)).toHaveLength(1);
  });

  it('keeps review progress when re-analysing', () => {
    const first = cardsFromLeaks([leak({})], {}, 0);
    const reviewed = { k: review(first.k, true, 0) };
    const again = cardsFromLeaks([leak({ count: 4 })], reviewed, 0);
    expect(again.k.reps).toBe(1);
    expect(again.k.due).toBe(DAY);
    expect(again.k.timesPlayed).toBe(4);
  });

  it('grows intervals on success and resets on failure', () => {
    let card = cardsFromLeaks([leak({})], {}, 0).k;
    card = review(card, true, 0);
    expect(card.intervalDays).toBe(1);
    card = review(card, true, 0);
    expect(card.intervalDays).toBe(3);
    card = review(card, true, 0);
    expect(card.intervalDays).toBeGreaterThanOrEqual(7);
    card = review(card, false, 0);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(1);
    expect(card.due).toBe(10 * 60 * 1000);
  });
});

describe('repertoire', () => {
  const g = (id: string, moves: string[], outcome: AnalyzedGame['outcome']): AnalyzedGame =>
    ({ id, userColor: 'white', outcome, moves, mistakes: [] }) as unknown as AnalyzedGame;

  const games = [
    g('1', ['e4', 'c5', 'Nf3'], 'loss'),
    g('2', ['e4', 'c5', 'Nf3'], 'loss'),
    g('3', ['e4', 'c5', 'Nf3'], 'draw'),
    g('4', ['e4', 'e5', 'Nf3'], 'win'),
  ];

  it('builds a tree with per-branch results', () => {
    const root = buildRepertoire(games, 'white');
    expect(root.games).toBe(4);
    const e4 = root.children[0];
    expect(e4.san).toBe('e4');
    expect(e4.isUserMove).toBe(true);
    expect(e4.children.map((c) => c.san)).toEqual(['c5', 'e5']);
    expect(nodeScore(e4.children[0])).toBeCloseTo(1 / 6);
  });

  it('flags the most specific weak line', () => {
    const weak = weakLines(buildRepertoire(games, 'white'), 3);
    expect(weak.map((n) => n.path.join(' '))).toEqual(['e4 c5 Nf3']);
  });
});
