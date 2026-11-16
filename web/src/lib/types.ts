export type Site = 'lichess' | 'chesscom';
export type Color = 'white' | 'black';
export type Outcome = 'win' | 'loss' | 'draw';
export type Speed = 'bullet' | 'blitz' | 'rapid' | 'classical' | 'daily';
export type Severity = 'inaccuracy' | 'mistake' | 'blunder';

/** A finished game, normalized so the rest of the app doesn't care which site it came from. */
export interface GameRecord {
  id: string;
  site: Site;
  url: string;
  white: string;
  black: string;
  userColor: Color;
  opponent: string;
  userRating?: number;
  opponentRating?: number;
  outcome: Outcome;
  timeControl: string;
  speed: Speed;
  /** ISO timestamp of when the game ended (or started, if that's all the site gives us). */
  date: string;
  /** Moves in SAN, from the standard starting position. */
  moves: string[];
  /** Opening name the site reported, used only if our own book lookup finds nothing. */
  openingHint?: string;
  ecoHint?: string;
}

export interface OpeningInfo {
  eco: string | null;
  name: string;
  /** Book moves (SAN) that define this opening. */
  line: string | null;
  /** How many plies of the game matched the book. */
  matchedPlies: number;
  source: 'book' | 'site' | 'unknown';
}

/** Engine evaluation of a single position. Scores are from White's point of view. */
export interface PositionEval {
  /** Centipawns, White POV. Undefined when a mate is found. */
  cp?: number;
  /** Mate in N, White POV: positive = White mates, negative = Black mates. */
  mate?: number;
  /** Principal variation in UCI. */
  pv: string[];
  depth: number;
}

export interface Mistake {
  gameId: string;
  ply: number;
  moveNumber: number;
  color: Color;
  fenBefore: string;
  /** Position key (FEN without move counters) used to group repeats across games. */
  positionKey: string;
  playedSan: string;
  playedUci: string;
  bestSan: string | null;
  bestUci: string | null;
  bestLineSan: string[];
  replySan: string | null;
  replyUci: string | null;
  /** Evals in pawns from the mover's point of view. */
  evalBefore: number;
  evalAfter: number;
  dropPawns: number;
  /** Drop in winning chances (0..2 scale, Lichess-style). */
  winDrop: number;
  severity: Severity;
  allowsMate: boolean;
}

export interface AnalyzedGame extends GameRecord {
  opening: OpeningInfo;
  /** How many half-moves were checked (adaptive: depends on where the game left the book). */
  analyzedPlies: number;
  mistakes: Mistake[];
}

/** The same wrong move, in the same position, across several games. */
export interface Leak {
  id: string;
  opening: string;
  eco: string | null;
  color: Color;
  fenBefore: string;
  positionKey: string;
  playedSan: string;
  playedUci: string;
  bestSan: string | null;
  bestUci: string | null;
  bestLineSan: string[];
  replySan: string | null;
  count: number;
  avgDropPawns: number;
  severity: Severity;
  gameIds: string[];
  moveNumber: number;
  /** Score (0..1) the user got in games where this happened. */
  scoreInGames: number;
}

export interface OpeningStat {
  name: string;
  eco: string | null;
  color: Color;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  mistakes: number;
  avgFirstMistakeMove: number | null;
}

export interface AnalysisParams {
  site: Site;
  username: string;
  maxGames: number;
  /** Upper limit for the adaptive opening cutoff, in half-moves. */
  maxPlies: number;
  depth: number;
  speeds: Speed[];
}

export interface Report {
  version: 2;
  createdAt: string;
  params: AnalysisParams;
  username: string;
  games: AnalyzedGame[];
  leaks: Leak[];
  openings: OpeningStat[];
  engineMs: number;
  cacheHits: number;
  positionsEvaluated: number;
}

export interface Progress {
  stage: 'fetching' | 'loading-engine' | 'analyzing' | 'summarizing' | 'done';
  message: string;
  current: number;
  total: number;
}
