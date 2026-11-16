import type { Speed } from './types';

/**
 * What real players at your level play in a position, from the Lichess opening database.
 * Engines say what's objectively best; this says what works (and what's common) in practice.
 */

export interface ExplorerMove {
  san: string;
  uci: string;
  games: number;
  /** Share of games in this position where this move was played (0..1). */
  share: number;
  /** Score for the side that played the move (wins + half of draws, 0..1). */
  score: number;
}

export interface ExplorerResult {
  total: number;
  moves: ExplorerMove[];
  band: [number, number];
}

/** Rating groups the Lichess database is split into. */
const BUCKETS = [0, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

/** The two rating groups closest to `rating`, e.g. 1650 → 1600–1800. */
export function ratingBand(rating: number): [number, number] {
  let i = BUCKETS.length - 1;
  while (i > 0 && BUCKETS[i] > rating) i--;
  const lo = BUCKETS[Math.min(i, BUCKETS.length - 2)];
  const hi = BUCKETS[Math.min(i + 1, BUCKETS.length - 1)];
  return [lo, hi];
}

const SPEED: Record<Speed, string> = { bullet: 'bullet', blitz: 'blitz', rapid: 'rapid', classical: 'classical', daily: 'correspondence' };

interface RawMove {
  san: string;
  uci: string;
  white: number;
  draws: number;
  black: number;
}

export function parseExplorer(raw: { white: number; draws: number; black: number; moves: RawMove[] }, whiteToMove: boolean, band: [number, number]): ExplorerResult {
  const total = raw.white + raw.draws + raw.black;
  const moves = raw.moves.map((m) => {
    const games = m.white + m.draws + m.black;
    const wins = whiteToMove ? m.white : m.black;
    return { san: m.san, uci: m.uci, games, share: total ? games / total : 0, score: games ? (wins + m.draws / 2) / games : 0 };
  });
  return { total, moves, band };
}

const cache = new Map<string, Promise<ExplorerResult>>();

export function fetchExplorer(fen: string, rating: number, speeds: Speed[]): Promise<ExplorerResult> {
  const band = ratingBand(rating);
  const params = new URLSearchParams({
    variant: 'standard',
    fen,
    ratings: band.join(','),
    speeds: (speeds.length ? speeds : (['blitz', 'rapid'] as Speed[])).map((s) => SPEED[s]).join(','),
    moves: '8',
    topGames: '0',
    recentGames: '0',
  });
  const key = params.toString();
  let p = cache.get(key);
  if (!p) {
    p = fetch(`https://explorer.lichess.ovh/lichess?${params}`).then(async (res) => {
      if (res.status === 429) throw new Error('The Lichess database is busy. Try again in a minute.');
      if (!res.ok) throw new Error(`The Lichess database returned an error (HTTP ${res.status}).`);
      return parseExplorer(await res.json(), fen.split(' ')[1] === 'w', band);
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export interface PracticalInsight {
  tone: 'bad' | 'good' | 'info';
  text: string;
}

/** Turns the database numbers into the one or two things worth saying. */
export function practicalInsights(result: ExplorerResult, playedSan: string, bestSan: string | null): PracticalInsight[] {
  const out: PracticalInsight[] = [];
  if (result.total < 50) {
    out.push({ tone: 'info', text: 'Few players at your level reach this position, so treat these numbers as rough.' });
  }
  const played = result.moves.find((m) => m.san === playedSan);
  const best = bestSan ? result.moves.find((m) => m.san === bestSan) : undefined;
  if (played && played.share >= 0.15 && played.score < 0.45) {
    out.push({
      tone: 'bad',
      text: `A common trap at your level: ${pct(played.share)} of players choose ${playedSan} here, and it scores only ${pct(played.score)}.`,
    });
  } else if (played && played.share >= 0.15) {
    out.push({ tone: 'info', text: `${playedSan} is a popular choice at your level (${pct(played.share)} of games), but the engine finds a clearly better move.` });
  } else if (!played && result.total >= 50) {
    out.push({ tone: 'info', text: `${playedSan} is rarely played at your level, so you're on your own after it.` });
  }
  if (bestSan && best && best.share < 0.05) {
    out.push({ tone: 'good', text: `${bestSan} is rarely played at your level (${pct(best.share)}), so most opponents won't be ready for it.` });
  } else if (best && played && best.score - played.score >= 0.05) {
    out.push({ tone: 'good', text: `In practice ${bestSan} scores ${pct(best.score)} at your level, against ${pct(played.score)} for ${playedSan}.` });
  }
  return out;
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}
