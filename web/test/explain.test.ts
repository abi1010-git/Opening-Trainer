import { describe, expect, it } from 'vitest';
import { explainMistake, type MistakeLike } from '../src/lib/explain';
import { parseExplorer, practicalInsights, ratingBand } from '../src/lib/explorer';
import { positionsFor } from '../src/lib/analysis';

function mistake(partial: Partial<MistakeLike>): MistakeLike {
  return {
    fenBefore: '',
    color: 'black',
    playedSan: '',
    bestSan: null,
    bestLineSan: [],
    refutationSan: [],
    allowsMate: false,
    evalBefore: 0,
    evalAfter: -3,
    lineBefore: [],
    ...partial,
  };
}

describe('explainMistake', () => {
  it('names a piece left to be captured', () => {
    // 1.e4 Nf6 2.e5: the knight is attacked, and 2...Nc6?? leaves it there.
    const fen = positionsFor(['e4', 'Nf6', 'e5'], 3).fens[3];
    const e = explainMistake(mistake({ fenBefore: fen, playedSan: 'Nc6', bestSan: 'Nd5', refutationSan: ['exf6'], lineBefore: ['e4', 'Nf6', 'e5'] }));
    expect(e.kind).toBe('material');
    expect(e.headline).toContain('knight on f6');
  });

  it('spots a knight fork', () => {
    const e = explainMistake(
      mistake({ fenBefore: 'r3k3/7p/8/1N6/8/8/8/4K3 b - - 0 1', playedSan: 'h6', bestSan: 'Ra5', refutationSan: ['Nc7+', 'Kd7', 'Nxa8'], lineBefore: Array(20).fill('x') }),
    );
    expect(e.kind).toBe('fork');
    expect(e.headline).toContain('king on e8');
    expect(e.headline).toContain('rook on a8');
  });

  it('reports a forced mate', () => {
    expect(explainMistake(mistake({ allowsMate: true, playedSan: 'f6', refutationSan: ['Qh5#'] })).kind).toBe('mate');
  });

  it('spots a missed win', () => {
    const e = explainMistake(
      mistake({ fenBefore: '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', color: 'white', playedSan: 'Ke2', bestSan: 'Rxd5', bestLineSan: ['Rxd5'], evalBefore: 9, evalAfter: 0, lineBefore: Array(20).fill('x') }),
    );
    expect(e.kind).toBe('missed-win');
    expect(e.headline).toContain('queen on d5');
  });

  it("doesn't claim material loss when the engine says the position is fine", () => {
    const fen = positionsFor(['e4', 'Nf6', 'e5'], 3).fens[3];
    const e = explainMistake(mistake({ fenBefore: fen, playedSan: 'Nc6', bestSan: 'Nd5', refutationSan: ['exf6'], evalBefore: 0, evalAfter: -0.6, lineBefore: Array(20).fill('x') }));
    expect(e.kind).toBe('positional');
  });

  it('names a dropped pawn', () => {
    // 1.Nc3 b5?: the pawn is simply taken by 2.Nxb5.
    const fen = positionsFor(['Nc3'], 1).fens[1];
    const e = explainMistake(mistake({ fenBefore: fen, playedSan: 'b5', bestSan: 'd5', refutationSan: ['Nxb5', 'd5'], evalBefore: -0.1, evalAfter: -1.2, lineBefore: ['Nc3'] }));
    expect(e.kind).toBe('material');
    expect(e.headline).toBe('b5 loses your pawn on b5: Nxb5 takes it right away.');
  });

  it("doesn't call it a missed win when your move takes the same piece", () => {
    // Caro-Kann: 5.Nxf6+ and both 5...exf6 and 5...gxf6 recapture the knight.
    const line = ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Nf6', 'Nxf6+'];
    const fen = positionsFor(line, line.length).fens[line.length];
    const e = explainMistake(
      mistake({ fenBefore: fen, playedSan: 'gxf6', bestSan: 'exf6', bestLineSan: ['exf6', 'c3'], refutationSan: ['c3', 'Bf5'], evalBefore: 0.4, evalAfter: 0.9, lineBefore: line }),
    );
    expect(e.kind).not.toBe('missed-win');
  });

  it('flags an early queen move', () => {
    const fen = positionsFor(['e4', 'e5'], 2).fens[2];
    const e = explainMistake(mistake({ fenBefore: fen, color: 'white', playedSan: 'Qh5', bestSan: 'Nf3', evalBefore: 0.3, evalAfter: -0.4, lineBefore: ['e4', 'e5'] }));
    expect(e.kind).toBe('early-queen');
  });
});

describe('explorer helpers', () => {
  it('picks the rating band around a rating', () => {
    expect(ratingBand(1650)).toEqual([1600, 1800]);
    expect(ratingBand(800)).toEqual([0, 1000]);
    expect(ratingBand(2700)).toEqual([2200, 2500]);
  });

  it('computes share and score for the side to move', () => {
    const r = parseExplorer(
      { white: 50, draws: 0, black: 50, moves: [{ san: 'e5', uci: 'e7e5', white: 30, draws: 0, black: 10 }, { san: 'c5', uci: 'c7c5', white: 20, draws: 0, black: 40 }] },
      false,
      [1600, 1800],
    );
    expect(r.moves[0]).toMatchObject({ san: 'e5', share: 0.4, score: 0.25 });
    expect(practicalInsights(r, 'e5', 'c5')[0].tone).toBe('bad');
  });
});
