import { Chess, type Move, type Square } from 'chess.js';
import type { Color } from './types';

/**
 * Rule-based explanations: replay the engine's lines and describe what actually happens
 * (a piece is lost, a fork, a forced mate...). No AI model, so it can't invent reasons.
 */

export type ExplanationKind = 'mate' | 'fork' | 'material' | 'missed-win' | 'early-queen' | 'development' | 'positional';

export interface Explanation {
  kind: ExplanationKind;
  headline: string;
  detail?: string;
}

export interface MistakeLike {
  fenBefore: string;
  color: Color;
  playedSan: string;
  bestSan: string | null;
  bestLineSan: string[];
  refutationSan: string[];
  allowsMate: boolean;
  evalBefore: number;
  evalAfter: number;
  lineBefore: string[];
}

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

interface MaterialResult {
  /** Material won minus material lost for the user, in pawns. */
  net: number;
  /** The most valuable piece the user lost (or won), with where and how. */
  biggest?: { piece: string; square: string; san: string };
  moves: Move[];
}

/** Plays `line` (SAN) from `fen` and tallies captures from `user`'s point of view. */
function materialAlong(fen: string, line: string[], user: 'w' | 'b', perspective: 'lost' | 'won'): MaterialResult {
  const chess = new Chess(fen);
  let net = 0;
  let biggest: MaterialResult['biggest'];
  const moves: Move[] = [];
  for (const san of line) {
    let mv: Move;
    try {
      mv = chess.move(san);
    } catch {
      break;
    }
    moves.push(mv);
    if (!mv.captured) continue;
    const value = VALUE[mv.captured];
    if (mv.color === user) {
      net += value;
      if (perspective === 'won' && (!biggest || value > VALUE[pieceKey(biggest.piece)])) biggest = { piece: NAME[mv.captured], square: mv.to, san: mv.san };
    } else {
      net -= value;
      if (perspective === 'lost' && (!biggest || value > VALUE[pieceKey(biggest.piece)])) biggest = { piece: NAME[mv.captured], square: mv.to, san: mv.san };
    }
  }
  return { net, biggest, moves };
}

function pieceKey(name: string): string {
  return Object.keys(NAME).find((k) => NAME[k] === name) ?? 'p';
}

/** User pieces (knight or better, or the king) attacked by the piece that just moved to `from`. */
function forkTargets(chess: Chess, from: Square, user: 'w' | 'b'): string[] {
  const targets: string[] = [];
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== user || sq.type === 'p') continue;
      if (chess.attackers(sq.square, user === 'w' ? 'b' : 'w').includes(from)) targets.push(`${NAME[sq.type]} on ${sq.square}`);
    }
  }
  return targets;
}

function joinList(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function explainMistake(m: MistakeLike): Explanation {
  const user = m.color === 'white' ? 'w' : 'b';
  const reply = m.refutationSan[0];
  const best = m.bestSan;

  if (m.allowsMate) {
    return {
      kind: 'mate',
      headline: `${m.playedSan} allows a forced checkmate.`,
      detail: m.refutationSan.length ? `Your opponent can play ${m.refutationSan.join(' ')}.` : undefined,
    };
  }

  // What happens after the mistake?
  const afterPlayed = new Chess(m.fenBefore);
  let playedMove: Move | null = null;
  try {
    playedMove = afterPlayed.move(m.playedSan);
  } catch {
    playedMove = null;
  }

  // Only blame lost material when the engine's evaluation agrees it's a real loss
  // (about a pawn's worth for a pawn, more for pieces).
  const evalDrop = m.evalBefore - m.evalAfter;
  if (playedMove && reply && evalDrop >= 0.8) {
    const lost = materialAlong(afterPlayed.fen(), m.refutationSan, user, 'lost');
    const firstReply = lost.moves[0];
    let fork: string[] = [];
    if (firstReply) {
      const board = new Chess(afterPlayed.fen());
      board.move(firstReply.san);
      fork = forkTargets(board, firstReply.to as Square, user);
    }
    if (fork.length >= 2 && lost.net <= -2 && evalDrop >= 1.5) {
      return {
        kind: 'fork',
        headline: `${m.playedSan} allows ${reply}, which attacks your ${joinList(fork)} at once.`,
        detail: lost.biggest ? `You can't save everything, and lose your ${lost.biggest.piece}.` : undefined,
      };
    }
    const realLoss = (lost.net <= -2 && evalDrop >= 1.5) || (lost.net === -1 && lost.biggest?.piece === 'pawn');
    if (realLoss && lost.biggest) {
      const how = lost.biggest.san === reply ? `${reply} takes it right away` : `after ${reply}, ${lost.biggest.san} wins it`;
      return {
        kind: 'material',
        headline: `${m.playedSan} loses your ${lost.biggest.piece} on ${lost.biggest.square}: ${how}.`,
        detail: `Line: ${m.refutationSan.join(' ')}.`,
      };
    }
  }

  // Did the better move win something?
  if (best && m.bestLineSan.length) {
    const won = materialAlong(m.fenBefore, m.bestLineSan, user, 'won');
    // Compare with what your actual move gets: if both win the same piece, nothing was missed.
    const playedNet = playedMove ? materialAlong(m.fenBefore, [m.playedSan, ...m.refutationSan], user, 'won').net : 0;
    if (won.net - playedNet >= 2 && won.biggest) {
      return {
        kind: 'missed-win',
        headline: `You missed ${best}, which wins the ${won.biggest.piece} on ${won.biggest.square}.`,
        detail: `Line: ${m.bestLineSan.join(' ')}.`,
      };
    }
  }

  const early = m.lineBefore.length < 12;
  let bestMove: Move | null = null;
  if (best) {
    try {
      bestMove = new Chess(m.fenBefore).move(best);
    } catch {
      bestMove = null;
    }
  }

  if (early && playedMove?.piece === 'q' && bestMove?.piece !== 'q') {
    return {
      kind: 'early-queen',
      headline: `Bringing the queen out this early lets your opponent chase it while developing.`,
      detail: best ? `${best} develops instead.` : undefined,
    };
  }

  const backRank = user === 'w' ? '1' : '8';
  const developsPiece = (mv: Move | null) => !!mv && (mv.piece === 'n' || mv.piece === 'b') && mv.from[1] === backRank;
  if (early && developsPiece(bestMove) && !developsPiece(playedMove) && playedMove?.piece !== 'k') {
    return {
      kind: 'development',
      headline: `${m.playedSan} falls behind in development. ${best} brings a new piece into play.`,
    };
  }

  const drop = Math.max(0, m.evalBefore - m.evalAfter);
  return {
    kind: 'positional',
    headline: `No immediate tactic: ${m.playedSan} is a positional error that gives up about ${drop.toFixed(1)} pawns of advantage.`,
    detail: best ? `${best} is better.${m.bestLineSan.length > 1 ? ` A likely continuation: ${m.bestLineSan.join(' ')}.` : ''}` : undefined,
  };
}
