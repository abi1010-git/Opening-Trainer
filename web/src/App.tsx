import { useCallback, useEffect, useRef, useState } from 'react';
import Home from './components/Home';
import Mistakes from './components/Mistakes';
import Overview from './components/Overview';
import ProgressView from './components/ProgressView';
import Repertoire from './components/Repertoire';
import Train from './components/Train';
import { Button, cx } from './components/ui';
import { ImportError, runAnalysis } from './lib/run';
import { cardsFromLeaks, dueCards, type Card } from './lib/srs';
import { cardOwner, loadCards, loadReport, saveCards, saveParams, saveReport } from './lib/storage';
import type { AnalysisParams, Progress, Report } from './lib/types';

type View = 'home' | 'overview' | 'mistakes' | 'repertoire' | 'train';
const VIEWS: View[] = ['home', 'overview', 'mistakes', 'repertoire', 'train'];

function viewFromHash(): View {
  const v = window.location.hash.replace(/^#\/?/, '').split('/')[0] as View;
  return VIEWS.includes(v) ? v : 'overview';
}

export default function App() {
  const [report, setReport] = useState<Report | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cards, setCards] = useState<Record<string, Card>>({});
  const ownerRef = useRef<string | null>(null);
  const [view, setView] = useState<View>(viewFromHash);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLeak, setSelectedLeak] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    loadReport().then((r) => {
      if (r) {
        ownerRef.current = cardOwner(r.params);
        setCards(loadCards(ownerRef.current));
      }
      setReport(r);
      setLoaded(true);
    });
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((v: View) => {
    window.location.hash = `/${v}`;
    setView(v);
    window.scrollTo({ top: 0 });
  }, []);

  const analyze = async (params: AnalysisParams) => {
    saveParams(params);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ stage: 'fetching', message: 'Starting', current: 0, total: params.maxGames });
    try {
      const r = await runAnalysis(params, setProgress, controller.signal);
      // Only drill real errors, plus inaccuracies you keep repeating.
      const drillable = r.leaks.filter((l) => l.severity !== 'inaccuracy' || l.count > 1);
      const owner = cardOwner(params);
      const nextCards = cardsFromLeaks(drillable, loadCards(owner));
      ownerRef.current = owner;
      setCards(nextCards);
      saveCards(owner, nextCards);
      setReport(r);
      await saveReport(r);
      setSelectedLeak(null);
      go('overview');
    } catch (err) {
      if ((err as Error).name === 'AbortError' || controller.signal.aborted) {
        setError(null);
      } else {
        console.error(err);
        setError(err instanceof ImportError ? err.message : `Something went wrong: ${(err as Error).message}`);
      }
      go('home');
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const updateCard = useCallback((card: Card) => {
    setCards((cur) => {
      const next = { ...cur, [card.id]: card };
      if (ownerRef.current) saveCards(ownerRef.current, next);
      return next;
    });
  }, []);

  const due = dueCards(cards).length;
  const showHome = !report || view === 'home';

  if (!loaded) return null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:flex-nowrap sm:py-0">
          <button onClick={() => go(report ? 'overview' : 'home')} className="flex items-center gap-2 font-bold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-lg leading-none text-[#08210f]">♞</span>
            <span className="hidden sm:inline">Opening Trainer</span>
          </button>
          {report && !progress && (
            <nav className="order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:mx-0 sm:w-auto sm:flex-1" aria-label="Sections">
              {(
                [
                  ['overview', 'Overview'],
                  ['mistakes', 'Mistakes'],
                  ['repertoire', 'Repertoire'],
                  ['train', 'Train'],
                ] as [View, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => go(v)}
                  aria-current={view === v ? 'page' : undefined}
                  className={cx(
                    'relative whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition',
                    view === v ? 'bg-panel-2 text-text' : 'text-muted hover:text-text',
                  )}
                >
                  {label}
                  {v === 'train' && due > 0 && (
                    <span className="ml-1.5 rounded-full bg-warn px-1.5 py-0.5 text-[10px] font-bold text-black">{due}</span>
                  )}
                </button>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            {report && !progress && view !== 'home' && (
              <>
                <span className="hidden text-sm text-muted md:inline">
                  {report.username} · {report.params.site === 'lichess' ? 'Lichess' : 'Chess.com'}
                </span>
                <Button variant="secondary" onClick={() => go('home')} className="px-3 py-1.5">
                  New analysis
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {progress ? (
          <ProgressView progress={progress} onCancel={() => abortRef.current?.abort()} />
        ) : showHome ? (
          <Home onSubmit={analyze} error={error} hasReport={!!report} onBack={() => go('overview')} />
        ) : (
          <div className="mx-auto max-w-6xl px-4 py-8">
            {view === 'overview' && (
              <>
                <div className="mb-6">
                  <h1 className="text-2xl font-bold tracking-tight">{report.username}'s opening report</h1>
                  <p className="mt-1 text-sm text-muted">
                    Last {report.games.length} games · analyzed {new Date(report.createdAt).toLocaleString()}
                  </p>
                </div>
                <Overview
                  report={report}
                  cards={cards}
                  onOpenLeak={(id) => {
                    setSelectedLeak(id);
                    go('mistakes');
                  }}
                  onTrain={() => go('train')}
                  onRepertoire={() => go('repertoire')}
                />
              </>
            )}
            {view === 'mistakes' && <Mistakes report={report} selectedId={selectedLeak} onSelect={setSelectedLeak} />}
            {view === 'repertoire' && <Repertoire report={report} />}
            {view === 'train' && <Train key={report.createdAt} cards={cards} onUpdate={updateCard} depth={report.params.depth} />}
          </div>
        )}
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        Runs entirely in your browser with Stockfish 19 (WASM). Games come from the public Lichess and Chess.com APIs. Your results are saved only on this device.
      </footer>
    </div>
  );
}
