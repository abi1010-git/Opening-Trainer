import { createStore, get, set, type UseStore } from 'idb-keyval';
import { positionKey } from './format';
import type { PositionEval } from './types';

/**
 * Stockfish (WASM, single-threaded) running in Web Workers.
 *
 * The single-threaded build works on any static host because it doesn't need SharedArrayBuffer
 * (and therefore no COOP/COEP headers). To still use every core, we run a small pool of workers
 * and analyse several games at once.
 */

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;

interface Job {
  fen: string;
  depth: number;
  resolve: (e: PositionEval) => void;
  reject: (err: Error) => void;
}

/** Parses a UCI "info" line. Returns the score from the side-to-move's point of view. */
export function parseInfoLine(line: string): { depth: number; cp?: number; mate?: number; pv: string[] } | null {
  if (!line.startsWith('info ') || !line.includes(' score ')) return null;
  const tokens = line.split(' ');
  const multipv = tokens.indexOf('multipv');
  if (multipv !== -1 && tokens[multipv + 1] !== '1') return null;
  if (tokens.includes('lowerbound') || tokens.includes('upperbound')) return null;
  const depth = Number(tokens[tokens.indexOf('depth') + 1]);
  const scoreAt = tokens.indexOf('score');
  const kind = tokens[scoreAt + 1];
  const value = Number(tokens[scoreAt + 2]);
  const pvAt = tokens.indexOf('pv');
  const pv = pvAt === -1 ? [] : tokens.slice(pvAt + 1);
  return kind === 'mate' ? { depth, mate: value, pv } : { depth, cp: value, pv };
}

class EngineWorker {
  private worker: Worker;
  private ready: Promise<void>;
  private current: Job | null = null;
  private last: ReturnType<typeof parseInfoLine> = null;
  private listeners: ((line: string) => void)[] = [];

  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (ev: MessageEvent) => this.onLine(String(ev.data));
    this.ready = new Promise((resolve, reject) => {
      this.worker.onerror = (e) => reject(new Error(`Engine failed to load: ${e.message}`));
      this.waitFor('uciok')
        .then(() => {
          this.send('setoption name Hash value 32');
          this.send('isready');
          return this.waitFor('readyok');
        })
        .then(resolve, reject);
      this.send('uci');
    });
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd);
  }

  private waitFor(token: string): Promise<void> {
    return new Promise((resolve) => {
      const fn = (line: string) => {
        if (line.startsWith(token)) {
          this.listeners = this.listeners.filter((l) => l !== fn);
          resolve();
        }
      };
      this.listeners.push(fn);
    });
  }

  private onLine(line: string) {
    for (const l of [...this.listeners]) l(line);
    const job = this.current;
    if (!job) return;
    const info = parseInfoLine(line);
    if (info) this.last = info;
    if (line.startsWith('bestmove')) {
      const best = line.split(' ')[1];
      const info = this.last;
      this.current = null;
      this.last = null;
      const whiteToMove = job.fen.split(' ')[1] === 'w';
      const sign = whiteToMove ? 1 : -1;
      const pv = info?.pv.length ? info.pv : best && best !== '(none)' ? [best] : [];
      job.resolve({
        cp: info?.cp !== undefined ? info.cp * sign : undefined,
        mate: info?.mate !== undefined ? info.mate * sign : undefined,
        pv,
        depth: info?.depth ?? 0,
      });
    }
  }

  async analyse(job: Job) {
    await this.ready;
    this.current = job;
    this.last = null;
    this.send(`position fen ${job.fen}`);
    this.send(`go depth ${job.depth}`);
  }

  stop() {
    this.send('stop');
  }

  terminate() {
    this.worker.terminate();
  }

  whenReady() {
    return this.ready;
  }
}

let cacheStore: UseStore | null = null;
function store() {
  cacheStore ??= createStore('opening-trainer-evals', 'evals');
  return cacheStore;
}

export interface PoolStats {
  cacheHits: number;
  evaluated: number;
}

export class EnginePool {
  private workers: EngineWorker[];
  private idle: EngineWorker[];
  private queue: Job[] = [];
  readonly size: number;
  stats: PoolStats = { cacheHits: 0, evaluated: 0 };

  constructor(size = defaultPoolSize()) {
    this.size = size;
    this.workers = Array.from({ length: size }, () => new EngineWorker());
    this.idle = [...this.workers];
  }

  async ready() {
    await Promise.all(this.workers.map((w) => w.whenReady()));
  }

  /** Evaluates a position, using the IndexedDB cache so repeated opening positions are free. */
  async evaluate(fen: string, depth: number): Promise<PositionEval> {
    const key = `v1|${depth}|${positionKey(fen)}`;
    try {
      const cached = await get<PositionEval>(key, store());
      if (cached) {
        this.stats.cacheHits++;
        return cached;
      }
    } catch {
      // IndexedDB can be unavailable (private mode); just skip the cache.
    }
    const result = await new Promise<PositionEval>((resolve, reject) => {
      this.queue.push({ fen, depth, resolve, reject });
      this.pump();
    });
    this.stats.evaluated++;
    set(key, result, store()).catch(() => {});
    return result;
  }

  private pump() {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop()!;
      const job = this.queue.shift()!;
      const done = () => {
        this.idle.push(worker);
        this.pump();
      };
      worker.analyse({
        ...job,
        resolve: (e) => {
          job.resolve(e);
          done();
        },
        reject: (err) => {
          job.reject(err);
          done();
        },
      }).catch((err) => {
        job.reject(err);
        done();
      });
    }
  }

  terminate() {
    for (const job of this.queue) job.reject(new Error('Analysis cancelled'));
    this.queue = [];
    for (const w of this.workers) w.terminate();
  }
}

export function defaultPoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(4, cores - 1));
}

let shared: EnginePool | null = null;
/** A long-lived single-worker pool for the training screen (checking alternative moves). */
export function sharedEngine(): EnginePool {
  shared ??= new EnginePool(1);
  return shared;
}
