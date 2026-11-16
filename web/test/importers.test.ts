import { describe, expect, it } from 'vitest';
import { normalizeChessComGame, normalizeLichessGame } from '../src/lib/importers';
import { identifyOpening, type OpeningBook } from '../src/lib/openings';
import { positionsFor } from '../src/lib/analysis';
import { positionKey } from '../src/lib/format';

describe('normalizeLichessGame', () => {
  const base = {
    id: 'abcd1234',
    variant: 'standard',
    speed: 'blitz',
    createdAt: 1700000000000,
    status: 'resign',
    players: { white: { user: { name: 'Alice', id: 'alice' }, rating: 1500 }, black: { user: { name: 'Bob', id: 'bob' }, rating: 1550 } },
    winner: 'black' as const,
    moves: 'e4 c5 Nf3',
    clock: { initial: 180, increment: 2 },
  };

  it('works out colour, result and time control (case-insensitive username)', () => {
    const g = normalizeLichessGame(base, 'BOB')!;
    expect(g.userColor).toBe('black');
    expect(g.outcome).toBe('win');
    expect(g.timeControl).toBe('3+2');
    expect(g.moves).toEqual(['e4', 'c5', 'Nf3']);
    expect(g.url).toBe('https://lichess.org/abcd1234/black');
  });

  it('skips variants and games from a custom position', () => {
    expect(normalizeLichessGame({ ...base, variant: 'chess960' }, 'bob')).toBeNull();
    expect(normalizeLichessGame({ ...base, initialFen: '8/8/8/8/8/8/8/8 w - - 0 1' }, 'bob')).toBeNull();
  });
});

describe('normalizeChessComGame', () => {
  const pgn = `[Event "Live Chess"]
[White "Alice"]
[Black "Bob"]
[Result "1/2-1/2"]
[ECO "B20"]
[ECOUrl "https://www.chess.com/openings/Sicilian-Defense-2.Nf3"]

1. e4 {[%clk 0:02:59]} c5 {[%clk 0:02:58]} 2. Nf3 1/2-1/2`;

  const raw = {
    url: 'https://www.chess.com/game/live/123456',
    pgn,
    time_control: '180',
    time_class: 'blitz',
    rules: 'chess',
    end_time: 1700000000,
    white: { username: 'Alice', rating: 1200, result: 'agreed' },
    black: { username: 'Bob', rating: 1210, result: 'agreed' },
  };

  it('parses the PGN (with clock comments) and the result', () => {
    const g = normalizeChessComGame(raw, 'alice')!;
    expect(g.userColor).toBe('white');
    expect(g.outcome).toBe('draw');
    expect(g.moves).toEqual(['e4', 'c5', 'Nf3']);
    expect(g.timeControl).toBe('3+0');
    expect(g.openingHint).toBe('Sicilian Defense');
    expect(g.id).toBe('chesscom:123456');
  });

  it('skips non-standard rules', () => {
    expect(normalizeChessComGame({ ...raw, rules: 'chess960' }, 'alice')).toBeNull();
  });

  it('marks losses correctly', () => {
    const g = normalizeChessComGame({ ...raw, white: { ...raw.white, result: 'resigned' }, black: { ...raw.black, result: 'win' } }, 'alice')!;
    expect(g.outcome).toBe('loss');
  });
});

describe('identifyOpening', () => {
  const book: OpeningBook = {
    [positionKey(positionsFor(['e4', 'c5'], 2).fens[2])]: ['B20', 'Sicilian Defense', 2, 'e4 c5'],
    [positionKey(positionsFor(['e4', 'c5', 'Nf3', 'd6'], 4).fens[4])]: ['B50', 'Sicilian Defense: Modern Variations', 4, 'e4 c5 Nf3 d6'],
  };

  it('picks the deepest named position', () => {
    expect(identifyOpening(['e4', 'c5', 'Nf3', 'd6', 'd4'], book).name).toBe('Sicilian Defense: Modern Variations');
  });

  it('matches transpositions by position, not move order', () => {
    // 1.Nf3 c5 2.e4 d6 reaches the same position as 1.e4 c5 2.Nf3 d6.
    expect(identifyOpening(['Nf3', 'c5', 'e4', 'd6'], book).eco).toBe('B50');
  });

  it('falls back to the site-provided name', () => {
    expect(identifyOpening(['d4'], book, "Queen's Pawn Game", 'A40')).toMatchObject({ name: "Queen's Pawn Game", source: 'site' });
  });
});
