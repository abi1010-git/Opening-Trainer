import { analyzeGame, findLeaks, openingStats } from './analysis';
import { EnginePool } from './engine';
import { importGames, ImportError } from './importers';
import { loadOpeningBook } from './openings';
import type { AnalysisParams, AnalyzedGame, Progress, Report } from './types';

export { ImportError };

/** Fetch → analyse → summarise, all in the browser. */
export async function runAnalysis(
  params: AnalysisParams,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<Report> {
  onProgress({ stage: 'fetching', message: 'Downloading your games', current: 0, total: params.maxGames });
  const [games, book] = await Promise.all([
    importGames(params.site, params.username, {
      maxGames: params.maxGames,
      speeds: params.speeds,
      sinceDays: params.sinceDays,
      signal,
      onProgress: (message) => onProgress({ stage: 'fetching', message, current: 0, total: params.maxGames }),
    }),
    loadOpeningBook(),
  ]);
  if (!games.length) {
    throw new ImportError(
      params.speeds.length || params.sinceDays
        ? `No standard games found for "${params.username}" with those filters.`
        : `No standard games found for "${params.username}".`,
    );
  }

  onProgress({ stage: 'loading-engine', message: 'Starting Stockfish in your browser', current: 0, total: games.length });
  const pool = new EnginePool();
  const abort = () => pool.terminate();
  signal.addEventListener('abort', abort);
  const started = performance.now();

  try {
    await pool.ready();
    const analyzed: AnalyzedGame[] = [];
    for (const [i, game] of games.entries()) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      onProgress({
        stage: 'analyzing',
        message: `Game ${i + 1} of ${games.length}: ${game.white} vs ${game.black}`,
        current: i,
        total: games.length,
      });
      analyzed.push(await analyzeGame(game, book, pool, params.maxPlies, params.depth));
    }

    onProgress({ stage: 'summarizing', message: 'Finding patterns', current: games.length, total: games.length });
    const report: Report = {
      version: 3,
      createdAt: new Date().toISOString(),
      params,
      username: inferDisplayName(analyzed, params.username),
      games: analyzed,
      leaks: findLeaks(analyzed),
      openings: openingStats(analyzed),
      engineMs: Math.round(performance.now() - started),
      cacheHits: pool.stats.cacheHits,
      positionsEvaluated: pool.stats.evaluated,
    };
    onProgress({ stage: 'done', message: 'Done', current: games.length, total: games.length });
    return report;
  } finally {
    signal.removeEventListener('abort', abort);
    pool.terminate();
  }
}

/** Use the site's capitalisation of the username. */
function inferDisplayName(games: AnalyzedGame[], fallback: string): string {
  const g = games[0];
  if (!g) return fallback;
  return g.userColor === 'white' ? g.white : g.black;
}
