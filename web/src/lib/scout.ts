import { positionsFor } from './analysis';
import { positionKey } from './format';
import type { AnalyzedGame, Color, Leak } from './types';

/**
 * Opponent prep: find positions where your next opponent keeps going wrong, and check whether
 * the openings *you* play can actually get there.
 */

export interface SteerTarget {
  leak: Leak;
  /** The colour you'd have in this game (the opposite of the opponent's colour in the leak). */
  yourColor: Color;
  /** How many of your own games reached this exact position. */
  yourGames: number;
}

const SCAN_PLIES = 30;

/** Position keys you reached as each colour, with how many games reached each. */
export function reachedPositions(games: AnalyzedGame[]): Record<Color, Map<string, number>> {
  const out: Record<Color, Map<string, number>> = { white: new Map(), black: new Map() };
  for (const g of games) {
    const seen = new Set<string>();
    for (const fen of positionsFor(g.moves, SCAN_PLIES).fens) {
      const key = positionKey(fen);
      if (seen.has(key)) continue;
      seen.add(key);
      out[g.userColor].set(key, (out[g.userColor].get(key) ?? 0) + 1);
    }
  }
  return out;
}

export function steerTargets(yourGames: AnalyzedGame[], opponentLeaks: Leak[], limit = 8): SteerTarget[] {
  const reached = reachedPositions(yourGames);
  const rank = { blunder: 3, mistake: 2, inaccuracy: 1 } as const;
  return opponentLeaks
    .map((leak) => {
      const yourColor: Color = leak.color === 'white' ? 'black' : 'white';
      return { leak, yourColor, yourGames: reached[yourColor].get(leak.positionKey) ?? 0 };
    })
    .sort(
      (a, b) =>
        Number(b.yourGames > 0) - Number(a.yourGames > 0) ||
        b.leak.count - a.leak.count ||
        rank[b.leak.severity] - rank[a.leak.severity] ||
        b.yourGames - a.yourGames,
    )
    .slice(0, limit);
}

export interface OpeningChoice {
  line: string;
  games: number;
  score: number;
}

/** The opponent's most common first moves as White, and replies to 1.e4 / 1.d4 / anything as Black. */
export function openingChoices(games: AnalyzedGame[], color: Color, limit = 4): OpeningChoice[] {
  const counts = new Map<string, { games: number; points: number }>();
  for (const g of games) {
    if (g.userColor !== color || g.moves.length < 2) continue;
    const line = color === 'white' ? `1.${g.moves[0]}` : `1.${g.moves[0]} ${g.moves[1]}`;
    const c = counts.get(line) ?? { games: 0, points: 0 };
    c.games++;
    c.points += g.outcome === 'win' ? 1 : g.outcome === 'draw' ? 0.5 : 0;
    counts.set(line, c);
  }
  return [...counts.entries()]
    .map(([line, c]) => ({ line, games: c.games, score: c.points / c.games }))
    .sort((a, b) => b.games - a.games)
    .slice(0, limit);
}
