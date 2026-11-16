import { Chess } from 'chess.js';
import { positionKey, winningChances } from './format';
import { identifyOpening, openingFamily, type OpeningBook } from './openings';
import type {
  AnalyzedGame,
  Color,
  GameRecord,
  Leak,
  Mistake,
  OpeningStat,
  PositionEval,
  Severity,
} from './types';

export interface Evaluator {
  evaluate(fen: string, depth: number): Promise<PositionEval>;
}

const MATE_PAWNS = 100;

/** Engine eval → pawns from White's point of view (mates count as ±100). */
export function evalToPawns(e: PositionEval): number {
  if (e.mate !== undefined) return e.mate > 0 ? MATE_PAWNS : e.mate < 0 ? -MATE_PAWNS : 0;
  return (e.cp ?? 0) / 100;
}

/**
 * Severity is judged on the drop in *winning chances*, not raw pawns, the same way Lichess does it.
 * Going from +8 to +6 is still completely winning and isn't worth drilling; going from 0 to -2 is.
 */
export function classifyMove(beforePawns: number, afterPawns: number, ply: number): Severity | null {
  const drop = beforePawns - afterPawns;
  const winDrop = (winningChances(beforePawns) - winningChances(afterPawns)) / 2;
  // Early in the opening, small engine preferences are noise; only flag real errors.
  if (ply <= 8 && drop < 1) return null;
  if (winDrop >= 0.15) return 'blunder';
  if (winDrop >= 0.1) return 'mistake';
  if (winDrop >= 0.05) return 'inaccuracy';
  return null;
}

function uciToMove(uci: string) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}

/** Converts a UCI line to SAN, stopping at the first illegal move. */
export function uciLineToSan(fen: string, line: string[], max = 6): string[] {
  const chess = new Chess(fen);
  const out: string[] = [];
  for (const uci of line.slice(0, max)) {
    try {
      out.push(chess.move(uciToMove(uci)).san);
    } catch {
      break;
    }
  }
  return out;
}

/** FENs of every position from the start through ply `plies`. */
export function positionsFor(moves: string[], plies: number): { fens: string[]; ucis: string[]; sans: string[] } {
  const chess = new Chess();
  const fens = [chess.fen()];
  const ucis: string[] = [];
  const sans: string[] = [];
  for (const san of moves.slice(0, plies)) {
    let move;
    try {
      move = chess.move(san);
    } catch {
      break;
    }
    ucis.push(move.lan);
    sans.push(move.san);
    fens.push(chess.fen());
  }
  return { fens, ucis, sans };
}

/** Always check at least the first 8 moves. */
export const MIN_OPENING_PLIES = 16;
/** Keep checking 6 moves past the last book position: that's where most opening mistakes happen. */
export const PLIES_PAST_BOOK = 12;

/**
 * Where "the opening" ends for one game: 6 moves after the game leaves known theory,
 * but never shorter than 8 moves or longer than `maxPlies`.
 */
export function openingCutoff(bookPlies: number, maxPlies: number): number {
  const min = Math.min(MIN_OPENING_PLIES, maxPlies);
  return Math.max(min, Math.min(maxPlies, bookPlies + PLIES_PAST_BOOK));
}

/**
 * Finds the user's mistakes in the opening phase of one game (see `openingCutoff`).
 * Each position is evaluated once: the eval "after" move N is the eval "before" move N+1,
 * which halves the engine work compared to evaluating before and after every move.
 */
export async function analyzeGame(
  game: GameRecord,
  book: OpeningBook,
  evaluator: Evaluator,
  maxPlies: number,
  depth: number,
): Promise<AnalyzedGame> {
  const opening = identifyOpening(game.moves, book, game.openingHint, game.ecoHint);
  const plies = Math.min(game.moves.length, openingCutoff(opening.matchedPlies, maxPlies));
  const { fens, ucis, sans } = positionsFor(game.moves, plies);
  const userMovesAt = sans.map((_, i) => i).filter((i) => (i % 2 === 0 ? 'white' : 'black') === game.userColor);

  // Only positions before/after the user's own moves matter.
  const needed = new Set<number>();
  for (const i of userMovesAt) {
    needed.add(i);
    needed.add(i + 1);
  }
  const evals = new Map<number, PositionEval>();
  await Promise.all(
    [...needed].map(async (i) => {
      evals.set(i, await evaluator.evaluate(fens[i], depth));
    }),
  );

  const mistakes: Mistake[] = [];
  for (const i of userMovesAt) {
    const before = evals.get(i)!;
    const after = evals.get(i + 1)!;
    const color: Color = game.userColor;
    const sign = color === 'white' ? 1 : -1;
    const beforePawns = evalToPawns(before) * sign;
    const afterPawns = evalToPawns(after) * sign;
    const severity = classifyMove(beforePawns, afterPawns, i + 1);
    const bestUci = before.pv[0] ?? null;
    if (!severity || bestUci === ucis[i]) continue;

    const bestLineSan = uciLineToSan(fens[i], before.pv, 6);
    const replyUci = after.pv[0] ?? null;
    const allowsMate = after.mate !== undefined && Math.sign(after.mate) === -sign && !(before.mate !== undefined && Math.sign(before.mate) === -sign);
    mistakes.push({
      gameId: game.id,
      ply: i + 1,
      moveNumber: Math.floor(i / 2) + 1,
      color,
      fenBefore: fens[i],
      positionKey: positionKey(fens[i]),
      playedSan: sans[i],
      playedUci: ucis[i],
      bestSan: bestLineSan[0] ?? null,
      bestUci,
      bestLineSan,
      replySan: replyUci ? (uciLineToSan(fens[i + 1], [replyUci], 1)[0] ?? null) : null,
      replyUci,
      evalBefore: round(beforePawns),
      evalAfter: round(afterPawns),
      dropPawns: round(beforePawns - afterPawns),
      winDrop: round((winningChances(beforePawns) - winningChances(afterPawns)) / 2, 3),
      severity: allowsMate ? 'blunder' : severity,
      allowsMate,
    });
  }

  return {
    ...game,
    opening,
    analyzedPlies: sans.length,
    mistakes,
  };
}

function round(x: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function outcomeScore(o: AnalyzedGame['outcome']) {
  return o === 'win' ? 1 : o === 'draw' ? 0.5 : 0;
}

const SEVERITY_RANK: Record<Severity, number> = { inaccuracy: 1, mistake: 2, blunder: 3 };

/** Groups the same wrong move in the same position across games. Recurring ones come first. */
export function findLeaks(games: AnalyzedGame[]): Leak[] {
  const byId = new Map<string, AnalyzedGame>(games.map((g) => [g.id, g]));
  const groups = new Map<string, Mistake[]>();
  for (const g of games) {
    for (const m of g.mistakes) {
      const key = `${m.positionKey}|${m.playedUci}`;
      const list = groups.get(key) ?? [];
      list.push(m);
      groups.set(key, list);
    }
  }

  const leaks: Leak[] = [];
  for (const [id, list] of groups) {
    const first = list[0];
    const game = byId.get(first.gameId)!;
    const worst = list.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a));
    const gameIds = [...new Set(list.map((m) => m.gameId))];
    leaks.push({
      id,
      opening: game.opening.name,
      eco: game.opening.eco,
      color: first.color,
      fenBefore: first.fenBefore,
      positionKey: first.positionKey,
      playedSan: first.playedSan,
      playedUci: first.playedUci,
      bestSan: first.bestSan,
      bestUci: first.bestUci,
      bestLineSan: first.bestLineSan,
      replySan: first.replySan,
      count: list.length,
      avgDropPawns: round(list.reduce((s, m) => s + Math.min(m.dropPawns, 10), 0) / list.length),
      severity: worst.severity,
      gameIds,
      moveNumber: first.moveNumber,
      scoreInGames: gameIds.reduce((s, gid) => s + outcomeScore(byId.get(gid)!.outcome), 0) / gameIds.length,
    });
  }

  return leaks.sort(
    (a, b) => b.count - a.count || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.avgDropPawns - a.avgDropPawns,
  );
}

/** Per-opening-family results (e.g. all Sicilians together), split by colour. */
export function openingStats(games: AnalyzedGame[]): OpeningStat[] {
  const map = new Map<string, OpeningStat & { firstMistakeSum: number; firstMistakeCount: number }>();
  for (const g of games) {
    const family = openingFamily(g.opening.name);
    const key = `${g.userColor}|${family}`;
    const s =
      map.get(key) ??
      { name: family, eco: null, color: g.userColor, games: 0, wins: 0, draws: 0, losses: 0, score: 0, mistakes: 0, avgFirstMistakeMove: null, firstMistakeSum: 0, firstMistakeCount: 0 };
    s.games++;
    if (g.outcome === 'win') s.wins++;
    else if (g.outcome === 'draw') s.draws++;
    else s.losses++;
    s.mistakes += g.mistakes.length;
    if (g.mistakes.length) {
      s.firstMistakeSum += g.mistakes[0].moveNumber;
      s.firstMistakeCount++;
    }
    map.set(key, s);
  }
  return [...map.values()]
    .map(({ firstMistakeSum, firstMistakeCount, ...s }) => ({
      ...s,
      score: (s.wins + s.draws / 2) / s.games,
      avgFirstMistakeMove: firstMistakeCount ? round(firstMistakeSum / firstMistakeCount, 1) : null,
    }))
    .sort((a, b) => b.games - a.games || a.score - b.score);
}
