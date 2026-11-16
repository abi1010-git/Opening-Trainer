import type { Progress } from '../lib/types';
import { Button, Card, cx } from './ui';

const STAGES: { key: Progress['stage']; label: string }[] = [
  { key: 'fetching', label: 'Download games' },
  { key: 'loading-engine', label: 'Start Stockfish' },
  { key: 'analyzing', label: 'Analyze openings' },
  { key: 'summarizing', label: 'Find patterns' },
];

export default function ProgressView({ progress, onCancel, title = 'Analyzing your games' }: { progress: Progress; onCancel: () => void; title?: string }) {
  const stageIndex = STAGES.findIndex((s) => s.key === progress.stage);
  const pct =
    progress.stage === 'analyzing'
      ? 10 + (progress.current / Math.max(1, progress.total)) * 85
      : progress.stage === 'summarizing' || progress.stage === 'done'
        ? 98
        : progress.stage === 'loading-engine'
          ? 8
          : 3;

  return (
    <div className="mx-auto max-w-xl px-4 py-20">
      <Card className="rise p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <span className="tabular-nums text-sm text-muted">{Math.round(pct)}%</span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 truncate text-sm text-muted" aria-live="polite">
          {progress.message}
        </p>
        <ol className="mt-6 space-y-2">
          {STAGES.map((s, i) => (
            <li key={s.key} className="flex items-center gap-3 text-sm">
              <span
                className={cx(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold',
                  i < stageIndex ? 'bg-accent text-[#08210f]' : i === stageIndex ? 'border-2 border-accent text-accent' : 'border border-line text-muted',
                )}
              >
                {i < stageIndex ? '✓' : i + 1}
              </span>
              <span className={i <= stageIndex ? 'text-text' : 'text-muted'}>{s.label}</span>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-xs text-muted">
          Stockfish is running on your own computer, so nothing waits on a server. You can keep this tab in the background.
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}
