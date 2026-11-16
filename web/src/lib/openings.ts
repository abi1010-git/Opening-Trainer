import { Chess } from 'chess.js';
import { positionKey } from './format';
import type { OpeningInfo } from './types';

/** positionKey → [eco, name, plies, line] built from data/openings.csv by scripts/build-openings.mjs */
export type OpeningBook = Record<string, [string, string, number, string]>;

let bookPromise: Promise<OpeningBook> | null = null;

/** The book is ~600 KB, so it's split into its own chunk and loaded only when analysis starts. */
export function loadOpeningBook(): Promise<OpeningBook> {
  bookPromise ??= import('../generated/openings.json').then((m) => m.default as unknown as OpeningBook);
  return bookPromise;
}

const MAX_BOOK_PLIES = 40;

/**
 * Finds the deepest named position the game reached. Matching by position (not by move order)
 * means transpositions get the right name, which ECO tags from the sites often miss.
 */
export function identifyOpening(moves: string[], book: OpeningBook, hint?: string, ecoHint?: string): OpeningInfo {
  const chess = new Chess();
  let best: OpeningBook[string] | null = null;
  let matchedPlies = 0;
  for (let i = 0; i < Math.min(moves.length, MAX_BOOK_PLIES); i++) {
    try {
      chess.move(moves[i]);
    } catch {
      break;
    }
    const entry = book[positionKey(chess.fen())];
    if (entry) {
      best = entry;
      matchedPlies = i + 1;
    }
  }
  if (best) {
    return { eco: best[0], name: best[1], line: best[3], matchedPlies, source: 'book' };
  }
  if (hint) return { eco: ecoHint ?? null, name: hint, line: null, matchedPlies: 0, source: 'site' };
  return { eco: null, name: 'Unknown opening', line: null, matchedPlies: 0, source: 'unknown' };
}

/** "Sicilian Defense: Najdorf Variation, English Attack" → "Sicilian Defense" */
export function openingFamily(name: string): string {
  return name.split(':')[0].trim();
}
