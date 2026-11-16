import { Chess } from 'chess.js';
import { formatTimeControl, parseChessComTimeControl } from './format';
import type { Color, GameRecord, Outcome, Site, Speed } from './types';

export class ImportError extends Error {}

export interface ImportOptions {
  maxGames: number;
  speeds: Speed[];
  /** Only games from the last N days (0 or undefined = any time). */
  sinceDays?: number;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export function importGames(site: Site, username: string, opts: ImportOptions): Promise<GameRecord[]> {
  const name = username.trim();
  if (!name) throw new ImportError('Enter a username first.');
  return site === 'lichess' ? importLichess(name, opts) : importChessCom(name, opts);
}

// ---------------------------------------------------------------- Lichess

interface LichessPlayer {
  user?: { name: string; id: string };
  aiLevel?: number;
  rating?: number;
}

export interface LichessGame {
  id: string;
  variant: string;
  speed: string;
  createdAt: number;
  lastMoveAt?: number;
  status: string;
  initialFen?: string;
  players: { white: LichessPlayer; black: LichessPlayer };
  winner?: 'white' | 'black';
  opening?: { eco: string; name: string };
  moves?: string;
  clock?: { initial: number; increment: number };
}

const LICHESS_SPEEDS: Record<Speed, string> = {
  bullet: 'bullet',
  blitz: 'blitz',
  rapid: 'rapid',
  classical: 'classical',
  daily: 'correspondence',
};

async function importLichess(username: string, opts: ImportOptions): Promise<GameRecord[]> {
  opts.onProgress?.('Downloading games from Lichess');
  const params = new URLSearchParams({
    // Over-fetch: variants and custom-position games are skipped below.
    max: String(Math.min(300, opts.maxGames * 2)),
    moves: 'true',
    opening: 'true',
    clocks: 'false',
    evals: 'false',
  });
  if (opts.speeds.length) params.set('perfType', opts.speeds.map((s) => LICHESS_SPEEDS[s]).join(','));
  const since = cutoffMs(opts.sinceDays);
  if (since) params.set('since', String(since));

  let res: Response;
  try {
    res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(username)}?${params}`, {
      headers: { Accept: 'application/x-ndjson' },
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ImportError('Could not reach Lichess. Check your connection and try again.');
  }
  if (res.status === 404) throw new ImportError(`No Lichess player called "${username}".`);
  if (res.status === 429) throw new ImportError('Lichess is rate-limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new ImportError(`Lichess returned an error (HTTP ${res.status}).`);

  const text = await res.text();
  const games = text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LichessGame)
    .map((g) => normalizeLichessGame(g, username))
    .filter((g): g is GameRecord => g !== null);
  return games.slice(0, opts.maxGames);
}

export function normalizeLichessGame(g: LichessGame, username: string): GameRecord | null {
  if (g.variant !== 'standard' || g.initialFen || !g.moves) return null;
  const whiteName = g.players.white.user?.name ?? (g.players.white.aiLevel ? `Stockfish level ${g.players.white.aiLevel}` : 'Anonymous');
  const blackName = g.players.black.user?.name ?? (g.players.black.aiLevel ? `Stockfish level ${g.players.black.aiLevel}` : 'Anonymous');
  const userColor: Color | null =
    whiteName.toLowerCase() === username.toLowerCase() ? 'white' : blackName.toLowerCase() === username.toLowerCase() ? 'black' : null;
  if (!userColor) return null;

  const outcome: Outcome = !g.winner ? 'draw' : g.winner === userColor ? 'win' : 'loss';
  const user = g.players[userColor];
  const opp = g.players[userColor === 'white' ? 'black' : 'white'];
  const speed: Speed = g.speed === 'correspondence' ? 'daily' : (['bullet', 'blitz', 'rapid', 'classical'].includes(g.speed) ? g.speed : 'blitz') as Speed;

  return {
    id: `lichess:${g.id}`,
    site: 'lichess',
    url: `https://lichess.org/${g.id}${userColor === 'black' ? '/black' : ''}`,
    white: whiteName,
    black: blackName,
    userColor,
    opponent: userColor === 'white' ? blackName : whiteName,
    userRating: user.rating,
    opponentRating: opp.rating,
    outcome,
    timeControl: g.clock ? formatTimeControl(g.clock.initial, g.clock.increment) : 'Daily',
    speed,
    date: new Date(g.lastMoveAt ?? g.createdAt).toISOString(),
    moves: g.moves.split(' ').filter(Boolean),
    openingHint: g.opening?.name,
    ecoHint: g.opening?.eco,
  };
}

// ---------------------------------------------------------------- Chess.com

interface ChessComPlayer {
  username: string;
  rating?: number;
  result: string;
}

export interface ChessComGame {
  url: string;
  pgn?: string;
  time_control?: string;
  time_class?: string;
  rules?: string;
  end_time?: number;
  eco?: string;
  initial_setup?: string;
  white: ChessComPlayer;
  black: ChessComPlayer;
}

const CHESSCOM_DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
/** Stop scanning after this many monthly archives, so a username with years of history stays fast. */
const MAX_ARCHIVES = 36;

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ImportError('Could not reach Chess.com. Check your connection and try again.');
  }
  if (res.status === 404) return null;
  if (res.status === 429) throw new ImportError('Chess.com is rate-limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new ImportError(`Chess.com returned an error (HTTP ${res.status}).`);
  return res.json();
}

async function importChessCom(username: string, opts: ImportOptions): Promise<GameRecord[]> {
  opts.onProgress?.('Finding your Chess.com game archives');
  const archives = (await getJson(
    `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/archives`,
    opts.signal,
  )) as { archives?: string[] } | null;
  if (!archives) throw new ImportError(`No Chess.com player called "${username}".`);

  const since = cutoffMs(opts.sinceDays);
  const months = [...(archives.archives ?? [])]
    .reverse()
    .slice(0, MAX_ARCHIVES)
    .filter((url) => !since || archiveEndMs(url) >= since);
  const games: GameRecord[] = [];
  for (const [i, monthUrl] of months.entries()) {
    opts.onProgress?.(`Downloading Chess.com games (month ${i + 1} of ${months.length} checked, ${games.length} found)`);
    const data = (await getJson(monthUrl, opts.signal)) as { games?: ChessComGame[] } | null;
    const monthGames = [...(data?.games ?? [])].sort((a, b) => (b.end_time ?? 0) - (a.end_time ?? 0));
    for (const raw of monthGames) {
      const game = normalizeChessComGame(raw, username);
      if (!game) continue;
      if (opts.speeds.length && !opts.speeds.includes(game.speed)) continue;
      if (since && Date.parse(game.date) < since) continue;
      games.push(game);
      if (games.length >= opts.maxGames) return games;
    }
  }
  return games;
}

function openingFromEcoUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const slug = decodeURIComponent(url.split('/openings/')[1] ?? '');
  if (!slug) return undefined;
  // "Caro-Kann-Defense-2.Nf3-d5-3.Nc3" → "Caro Kann Defense"
  const words = slug.split('-');
  const cut = words.findIndex((w) => /^\d+\./.test(w));
  return (cut === -1 ? words : words.slice(0, cut)).join(' ').trim() || undefined;
}

export function normalizeChessComGame(g: ChessComGame, username: string): GameRecord | null {
  if (g.rules && g.rules !== 'chess') return null;
  if (g.initial_setup && g.initial_setup !== START_FEN) return null;
  if (!g.pgn) return null;

  const u = username.toLowerCase();
  const userColor: Color | null = g.white.username.toLowerCase() === u ? 'white' : g.black.username.toLowerCase() === u ? 'black' : null;
  if (!userColor) return null;

  const chess = new Chess();
  try {
    chess.loadPgn(g.pgn);
  } catch {
    return null;
  }
  const headers = chess.getHeaders();
  if (headers.SetUp === '1') return null;
  const moves = chess.history();
  if (!moves.length) return null;

  const me = g[userColor];
  const opp = g[userColor === 'white' ? 'black' : 'white'];
  const outcome: Outcome = me.result === 'win' ? 'win' : CHESSCOM_DRAWS.has(me.result) ? 'draw' : 'loss';
  const timeClass = g.time_class ?? 'blitz';
  const speed: Speed = (['bullet', 'blitz', 'rapid', 'daily'].includes(timeClass) ? timeClass : 'blitz') as Speed;
  const id = g.url.split('/').pop() ?? g.url;

  return {
    id: `chesscom:${id}`,
    site: 'chesscom',
    url: g.url,
    white: g.white.username,
    black: g.black.username,
    userColor,
    opponent: opp.username,
    userRating: me.rating,
    opponentRating: opp.rating,
    outcome,
    timeControl: parseChessComTimeControl(g.time_control),
    speed,
    date: new Date((g.end_time ?? 0) * 1000).toISOString(),
    moves,
    openingHint: openingFromEcoUrl(headers.ECOUrl ?? g.eco),
    ecoHint: headers.ECO,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function cutoffMs(days: number | undefined): number | null {
  return days && days > 0 ? Date.now() - days * DAY_MS : null;
}

/** ".../games/2026/03" → the first moment of April 2026 (UTC), i.e. when that month's archive ends. */
export function archiveEndMs(url: string): number {
  const m = url.match(/(\d{4})\/(\d{2})\/?$/);
  if (!m) return Infinity;
  return Date.UTC(Number(m[1]), Number(m[2]), 1);
}
