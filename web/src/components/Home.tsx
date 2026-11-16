import { useState, type FormEvent } from 'react';
import { SPEEDS } from '../lib/format';
import { loadParams } from '../lib/storage';
import type { AnalysisParams, Site, Speed } from '../lib/types';
import { Button, Card, cx, Segmented } from './ui';

const GAME_COUNTS = [10, 25, 50, 100];

interface Props {
  onSubmit: (p: AnalysisParams) => void;
  error?: string | null;
  hasReport: boolean;
  onBack?: () => void;
}

export default function Home({ onSubmit, error, hasReport, onBack }: Props) {
  const saved = loadParams();
  const [site, setSite] = useState<Site>(saved.site ?? 'lichess');
  const [username, setUsername] = useState(saved.username ?? '');
  const [maxGames, setMaxGames] = useState(saved.maxGames ?? 25);
  const [speeds, setSpeeds] = useState<Speed[]>(saved.speeds ?? []);
  const [maxPlies, setMaxPlies] = useState(saved.maxPlies ?? 30);
  const [depth, setDepth] = useState(saved.depth ?? 12);
  const [sinceDays, setSinceDays] = useState(saved.sinceDays ?? 0);

  const toggleSpeed = (s: Speed) => setSpeeds((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    onSubmit({ site, username: username.trim(), maxGames, speeds, maxPlies, depth, sinceDays });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-10 sm:pt-16">
      <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="rise">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Free · runs in your browser · no account
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Stop losing to the <span className="text-accent">same opening mistake</span> twice.
          </h1>
          <p className="mt-4 max-w-lg text-base text-muted">
            Import your Lichess or Chess.com games. Stockfish finds the opening mistakes you <em>keep repeating</em>, maps the
            repertoire you actually play, and turns your errors into spaced-repetition drills built only from your games.
          </p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {[
              ['Patterns, not one-off blunders', 'Groups the same wrong move across games, so you fix the habit, not the game.'],
              ['Your real repertoire', 'A move tree of what you actually play, with your score in every line.'],
              ['Drills that stick', 'Mistakes come back on a spaced-repetition schedule until you play the right move.'],
            ].map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />
                <div>
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="text-sm text-muted">{body}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <Card className="rise p-6 [animation-delay:80ms]">
          <form onSubmit={submit} className="space-y-5">
            <div>
              <div className="mb-2 text-sm font-medium">Where do you play?</div>
              <Segmented<Site>
                label="Chess site"
                value={site}
                onChange={setSite}
                options={[
                  { value: 'lichess', label: 'Lichess' },
                  { value: 'chesscom', label: 'Chess.com' },
                ]}
              />
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-medium">Username</span>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={`Your ${site === 'lichess' ? 'Lichess' : 'Chess.com'} username`}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-base outline-none placeholder:text-muted/60 focus:border-accent"
              />
            </label>

            <div>
              <div className="mb-2 text-sm font-medium">Recent games</div>
              <div className="flex flex-wrap gap-2">
                {GAME_COUNTS.map((n) => (
                  <Chip key={n} active={maxGames === n} onClick={() => setMaxGames(n)}>
                    {n}
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">
                Time controls <span className="font-normal text-muted">{speeds.length ? '' : '(all)'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {SPEEDS.filter((s) => site === 'lichess' || s !== 'classical').map((s) => (
                  <Chip key={s} active={speeds.includes(s)} onClick={() => toggleSpeed(s)}>
                    <span className="capitalize">{s}</span>
                  </Chip>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">Played in</div>
              <div className="flex flex-wrap gap-2">
                {[
                  [0, 'Any time'],
                  [30, 'Last month'],
                  [90, 'Last 3 months'],
                  [365, 'Last year'],
                ].map(([days, label]) => (
                  <Chip key={days} active={sinceDays === days} onClick={() => setSinceDays(days as number)}>
                    {label}
                  </Chip>
                ))}
              </div>
            </div>

            <details className="group rounded-lg border border-line bg-panel-2/50 px-3 py-2">
              <summary className="cursor-pointer select-none text-sm text-muted group-open:mb-3">Advanced</summary>
              <Slider label="Check moves up to" value={maxPlies} min={16} max={40} step={2} onChange={setMaxPlies} display={`move ${maxPlies / 2}`} />
              <Slider label="Engine depth" value={depth} min={8} max={18} onChange={setDepth} display={`depth ${depth}`} />
              <p className="mt-2 text-xs text-muted">Each game is checked until 6 moves after it leaves opening theory (at least 8 moves, at most the limit above). Higher depth is more accurate but slower. Results are cached, so re-runs are quick.</p>
            </details>

            {error && <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}

            <div className="flex gap-2">
              <Button type="submit" className="flex-1 py-3 text-base" disabled={!username.trim()}>
                Analyze my openings
              </Button>
              {hasReport && onBack && (
                <Button type="button" variant="secondary" onClick={onBack}>
                  Back to report
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'rounded-full border px-3 py-1 text-sm font-medium transition',
        active ? 'border-accent bg-accent/15 text-accent' : 'border-line text-muted hover:border-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; display: string }) {
  return (
    <label className="mb-3 block">
      <div className="mb-1 flex justify-between text-sm">
        <span>{props.label}</span>
        <span className="tabular-nums text-muted">{props.display}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </label>
  );
}
