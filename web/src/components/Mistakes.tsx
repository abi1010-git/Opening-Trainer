import { useEffect, useMemo, useState } from 'react';
import { positionsFor } from '../lib/analysis';
import { formatEval, moveLabel, plural } from '../lib/format';
import type { AnalyzedGame, Color, Leak, Report, Severity } from '../lib/types';
import Board, { type Arrow } from './Board';
import { Button, Card, ColorDot, cx, Empty, Segmented, SeverityBadge } from './ui';

interface Props {
  report: Report;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

type ColorFilter = 'all' | Color;
type SeverityFilter = 'all' | Severity;

export default function Mistakes({ report, selectedId, onSelect }: Props) {
  const [color, setColor] = useState<ColorFilter>('all');
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [repeatedOnly, setRepeatedOnly] = useState(false);

  const leaks = useMemo(
    () =>
      report.leaks.filter(
        (l) => (color === 'all' || l.color === color) && (severity === 'all' || l.severity === severity) && (!repeatedOnly || l.count > 1),
      ),
    [report.leaks, color, severity, repeatedOnly],
  );
  const selected = report.leaks.find((l) => l.id === selectedId) ?? leaks[0] ?? null;

  if (!report.leaks.length) {
    return <Empty title="No opening mistakes found">Try analyzing more games, or more moves of each game under Advanced.</Empty>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div>{selected ? <LeakDetail key={selected.id} leak={selected} games={report.games} /> : <Empty title="No mistakes match these filters" />}</div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Segmented<ColorFilter>
            label="Colour"
            value={color}
            onChange={setColor}
            options={[
              { value: 'all', label: 'Both' },
              { value: 'white', label: 'White' },
              { value: 'black', label: 'Black' },
            ]}
          />
          <select
            aria-label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as SeverityFilter)}
            className="rounded-lg border border-line bg-panel-2 px-3 text-sm"
          >
            <option value="all">All severities</option>
            <option value="blunder">Blunders</option>
            <option value="mistake">Mistakes</option>
            <option value="inaccuracy">Inaccuracies</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 text-sm">
            <input type="checkbox" checked={repeatedOnly} onChange={(e) => setRepeatedOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
            Repeated only
          </label>
        </div>
        <div className="text-xs text-muted">{plural(leaks.length, 'mistake')}</div>
        <ul className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
          {leaks.map((l) => (
            <li key={l.id}>
              <button
                onClick={() => onSelect(l.id)}
                className={cx(
                  'w-full rounded-lg border px-3 py-2.5 text-left transition',
                  selected?.id === l.id ? 'border-accent bg-accent/5' : 'border-line bg-panel hover:border-muted',
                )}
              >
                <div className="flex items-center gap-2">
                  <ColorDot color={l.color} />
                  <span className="font-semibold">{moveLabel(l.moveNumber, l.color, l.playedSan)}</span>
                  <SeverityBadge severity={l.severity} />
                  {l.count > 1 && <span className="ml-auto text-xs font-semibold text-warn">×{l.count}</span>}
                </div>
                <div className="mt-1 truncate text-xs text-muted">{l.opening}</div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LeakDetail({ leak, games }: { leak: Leak; games: AnalyzedGame[] }) {
  const leakGames = leak.gameIds.map((id) => games.find((g) => g.id === id)).filter((g): g is AnalyzedGame => !!g);
  const [gameIdx, setGameIdx] = useState(0);
  const game = leakGames[gameIdx] ?? leakGames[0];
  const mistake = game?.mistakes.find((m) => m.positionKey === leak.positionKey && m.playedUci === leak.playedUci);
  const mistakeIndex = mistake ? mistake.ply - 1 : 0;

  const { fens, ucis, sans } = useMemo(() => positionsFor(game?.moves ?? [], Math.max(mistakeIndex + 12, 20)), [game, mistakeIndex]);
  const [index, setIndex] = useState(mistakeIndex);
  useEffect(() => setIndex(mistakeIndex), [mistakeIndex, gameIdx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(fens.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fens.length]);

  const atMistake = index === mistakeIndex;
  const arrows: Arrow[] = atMistake
    ? [{ uci: leak.playedUci, brush: 'red' }, ...(leak.bestUci ? [{ uci: leak.bestUci, brush: 'green' as const }] : [])]
    : [];

  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div>
        <Board fen={fens[index] ?? leak.fenBefore} orientation={leak.color} viewOnly arrows={arrows} lastMove={index > 0 ? ucis[index - 1] : null} />
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" onClick={() => setIndex(0)} aria-label="First move">
            ⏮
          </Button>
          <Button variant="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))} aria-label="Previous move">
            ◀
          </Button>
          <Button variant={atMistake ? 'primary' : 'secondary'} className="flex-1" onClick={() => setIndex(mistakeIndex)}>
            {atMistake ? 'The mistake' : 'Jump to mistake'}
          </Button>
          <Button variant="secondary" onClick={() => setIndex((i) => Math.min(fens.length - 1, i + 1))} aria-label="Next move">
            ▶
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-1.5 gap-y-1 font-mono text-xs">
          {sans.map((san, i) => (
            <button
              key={i}
              onClick={() => setIndex(i + 1)}
              className={cx(
                'rounded px-1 py-0.5',
                index === i + 1 ? 'bg-panel-2 text-text' : 'text-muted hover:text-text',
                i === mistakeIndex && 'font-bold text-bad',
              )}
            >
              {i % 2 === 0 ? `${i / 2 + 1}.` : ''}
              {san}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <SeverityBadge severity={leak.severity} />
            <span className="text-xs text-muted">{leak.eco ? `${leak.eco} · ` : ''}{leak.opening}</span>
          </div>
          <p className="text-base">
            You played <span className="font-semibold text-bad">{moveLabel(leak.moveNumber, leak.color, leak.playedSan)}</span>
            {leak.count > 1 ? (
              <>
                {' '}
                in <span className="font-semibold text-warn">{leak.count} games</span>
              </>
            ) : null}
            . It costs about <span className="font-semibold">{leak.avgDropPawns.toFixed(1)} pawns</span>
            {leak.replySan && (
              <>
                , because of <span className="font-semibold">{leak.replySan}</span>
              </>
            )}
            .
          </p>
          {leak.bestSan && (
            <div className="rounded-lg bg-accent/10 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-accent">Better</div>
              <div className="mt-1 font-mono text-sm">
                <span className="font-bold text-accent">{leak.bestSan}</span> {leak.bestLineSan.slice(1).join(' ')}
              </div>
            </div>
          )}
          {mistake && (
            <div className="flex gap-4 text-xs text-muted">
              <span>Before: {formatEval(mistake.evalBefore)}</span>
              <span>After: {formatEval(mistake.evalAfter)}</span>
              {mistake.allowsMate && <span className="font-semibold text-bad">Allows a forced mate</span>}
            </div>
          )}
          <p className="text-xs text-muted">You scored {Math.round(leak.scoreInGames * 100)}% in these games. Use ← → to step through the game.</p>
        </Card>

        <Card className="p-0">
          <div className="border-b border-line px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted">
            {leakGames.length > 1 ? `Games (${leakGames.length})` : 'Game'}
          </div>
          <ul>
            {leakGames.map((g, i) => (
              <li key={g.id} className="flex items-center gap-3 border-b border-line/60 px-4 py-2.5 text-sm last:border-0">
                <button onClick={() => setGameIdx(i)} className={cx('min-w-0 flex-1 text-left', i === gameIdx ? 'text-text' : 'text-muted hover:text-text')}>
                  <div className="truncate">
                    vs {g.opponent}
                    {g.opponentRating ? ` (${g.opponentRating})` : ''}
                  </div>
                  <div className="text-xs text-muted">
                    {g.timeControl} · {new Date(g.date).toLocaleDateString()}
                  </div>
                </button>
                <OutcomeTag outcome={g.outcome} />
                <a href={g.url} target="_blank" rel="noreferrer" className="text-xs text-info hover:underline">
                  Open ↗
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export function OutcomeTag({ outcome }: { outcome: AnalyzedGame['outcome'] }) {
  return (
    <span
      className={cx(
        'rounded px-1.5 py-0.5 text-[11px] font-bold uppercase',
        outcome === 'win' && 'bg-accent/15 text-accent',
        outcome === 'loss' && 'bg-bad/15 text-bad',
        outcome === 'draw' && 'bg-muted/15 text-muted',
      )}
    >
      {outcome}
    </span>
  );
}
