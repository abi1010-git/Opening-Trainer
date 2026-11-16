import type { Speed } from './types';

/** "180+2" style seconds string → "3+2". Daily games ("1/86400") → "Daily". */
export function formatTimeControl(baseSeconds: number | null, increment: number): string {
  if (baseSeconds == null) return 'Daily';
  const base = baseSeconds % 60 === 0 ? String(baseSeconds / 60) : `${baseSeconds}s`;
  return `${base}+${increment}`;
}

export function parseChessComTimeControl(raw: string | undefined): string {
  if (!raw) return 'Unknown';
  if (raw.includes('/')) return 'Daily';
  const [base, inc] = raw.split('+');
  const b = Number(base);
  if (!Number.isFinite(b)) return raw;
  return formatTimeControl(b, Number(inc) || 0);
}

/** FEN without the halfmove/fullmove counters, so transpositions group together. */
export function positionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

/** Lichess' winning-chances curve: maps centipawns to [-1, 1]. */
export function winningChances(pawns: number): number {
  const cp = Math.max(-1000, Math.min(1000, pawns * 100));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

export function formatEval(pawns: number): string {
  if (pawns >= 99) return '#';
  if (pawns <= -99) return '-#';
  return (pawns > 0 ? '+' : '') + pawns.toFixed(1);
}

export function moveLabel(moveNumber: number, color: 'white' | 'black', san: string): string {
  return color === 'white' ? `${moveNumber}. ${san}` : `${moveNumber}… ${san}`;
}

export const SPEEDS: Speed[] = ['bullet', 'blitz', 'rapid', 'classical', 'daily'];

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
