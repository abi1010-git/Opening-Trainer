import { useMemo, useRef, useState, type FormEvent } from 'react';
import { explainMistake } from '../lib/explain';
import { moveLabel, pct, plural } from '../lib/format';
import { buildRepertoire, nodeScore, weakLines } from '../lib/repertoire';
import { ImportError, runAnalysis } from '../lib/run';
import { openingChoices, steerTargets } from '../lib/scout';
import type { Progress, Report, Site } from '../lib/types';
import Board from './Board';
import { formatLine } from './Overview';
import ProgressView from './ProgressView';
import { Button, Card, ColorDot, Empty, ScoreBar, SectionTitle, Segmented, SeverityBadge } from './ui';

interface Props {
  report: Report;
  result: Report | null;
  onResult: (r: Report | null) => void;
}

export default function Scout({ report, result, onResult }: Props) {
  const [site, setSite] = useState<Site>(report.params.site);
  const [username, setUsername] = useState('');
  const [maxGames, setMaxGames] = useState(50);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scout = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ stage: 'fetching', message: 'Starting', current: 0, total: maxGames });
    try {
      const r = await runAnalysis(
        { ...report.params, site, username: username.trim(), maxGames },
        setProgress,
        controller.signal,
      );
      onResult(r);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof ImportError ? err.message : `Something went wrong: ${(err as Error).message}`);
    } finally {
      setProgress(null);
    }
  };

  if (progress) return <ProgressView title={`Scouting ${username.trim()}`} progress={progress} onCancel={() => abortRef.current?.abort()} />;

  return (
    <div className="space-y-8">
      <Card>
        <form onSubmit={scout} className="flex flex-wrap items-end gap-4">
          <div>
            <div className="mb-2 text-sm font-medium">Opponent plays on</div>
            <Segmented<Site>
              label="Opponent's site"
              value={site}
              onChange={setSite}
              options={[
                { value: 'lichess', label: 'Lichess' },
                { value: 'chesscom', label: 'Chess.com' },
              ]}
            />
          </div>
          <label className="min-w-48 flex-1">
            <span className="mb-2 block text-sm font-medium">Opponent's username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Who are you playing next?"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 outline-none placeholder:text-muted/60 focus:border-accent"
            />
          </label>
          <Segmented<string>
            label="Games to scan"
            value={String(maxGames)}
            onChange={(v) => setMaxGames(Number(v))}
            options={[
              { value: '25', label: '25 games' },
              { value: '50', label: '50 games' },
            ]}
          />
          <Button type="submit" disabled={!username.trim()}>
            Scout opponent
          </Button>
        </form>
        {error && <div className="mt-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
        <p className="mt-3 text-xs text-muted">
          Analyzes your opponent's recent games, finds the mistakes they repeat, and checks which of them your own openings can reach.
        </p>
      </Card>

      {result ? <ScoutResult you={report} them={result} /> : <Empty title="Prepare for your next game">Enter an opponent's username to see where they go wrong.</Empty>}
    </div>
  );
}

function ScoutResult({ you, them }: { you: Report; them: Report }) {
  const targets = useMemo(() => steerTargets(you.games, them.leaks), [you.games, them.leaks]);
  const asWhite = useMemo(() => openingChoices(them.games, 'white'), [them.games]);
  const asBlack = useMemo(() => openingChoices(them.games, 'black'), [them.games]);
  const weak = useMemo(
    () => [
      ...weakLines(buildRepertoire(them.games, 'white'), 3, 3).map((n) => ({ n, color: 'white' as const })),
      ...weakLines(buildRepertoire(them.games, 'black'), 3, 3).map((n) => ({ n, color: 'black' as const })),
    ],
    [them.games],
  );
  const score = them.games.reduce((s, g) => s + (g.outcome === 'win' ? 1 : g.outcome === 'draw' ? 0.5 : 0), 0) / them.games.length;
  const reachable = targets.filter((t) => t.yourGames > 0).length;

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Scouting report: {them.username}</h2>
        <p className="mt-1 text-sm text-muted">
          {plural(them.games.length, 'recent game')} · scores {pct(score)} · {plural(them.leaks.filter((l) => l.count > 1).length, 'repeated mistake')}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ChoiceCard title={`When ${them.username} has White`} choices={asWhite} />
        <ChoiceCard title={`When ${them.username} has Black`} choices={asBlack} />
      </div>

      <section>
        <SectionTitle
          title="Where to steer the game"
          subtitle={
            reachable
              ? `${plural(reachable, 'position')} where they go wrong that your own openings already reach.`
              : "Positions where they go wrong. None come up in your recent games yet, so here's the line to get there."
          }
        />
        {targets.length === 0 ? (
          <Card className="text-sm text-muted">No opening mistakes found in their recent games.</Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {targets.map((t) => {
              const why = explainMistake(t.leak);
              return (
                <Card key={t.leak.id} className="flex gap-4 p-3">
                  <div className="w-36 shrink-0 sm:w-44">
                    <Board
                      fen={t.leak.fenBefore}
                      orientation={t.yourColor}
                      viewOnly
                      coordinates={false}
                      arrows={[{ uci: t.leak.playedUci, brush: 'red' }]}
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={t.leak.severity} />
                      {t.leak.count > 1 && <span className="text-xs font-semibold text-warn">×{t.leak.count} games</span>}
                    </div>
                    <div className="truncate text-xs text-muted">{t.leak.opening}</div>
                    <div>
                      They play <span className="font-semibold text-bad">{moveLabel(t.leak.moveNumber, t.leak.color, t.leak.playedSan)}</span>
                      {t.leak.bestSan && (
                        <>
                          {' '}
                          instead of <span className="font-semibold">{t.leak.bestSan}</span>
                        </>
                      )}
                      .
                    </div>
                    <div className="text-xs text-muted">{why.headline}</div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <ColorDot color={t.yourColor} />
                      {t.yourGames > 0 ? (
                        <span className="text-accent">You reached this in {plural(t.yourGames, 'game')} as {t.yourColor}.</span>
                      ) : (
                        <span className="font-mono text-muted">{formatLine(t.leak.lineBefore) || 'Starting position'}</span>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {weak.length > 0 && (
        <section>
          <SectionTitle title="Lines they score badly in" subtitle="Branches they reach in 3+ games and score under 45%." />
          <div className="grid gap-3 md:grid-cols-2">
            {weak.map(({ n, color }) => (
              <Card key={color + n.path.join(' ')} className="flex items-center gap-4 p-4">
                <ColorDot color={color} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm">{formatLine(n.path)}</div>
                  <div className="mt-1 text-xs text-muted">
                    {plural(n.games, 'game')} · <span className="text-bad">{pct(nodeScore(n))} score</span>
                    {n.games < 5 && ' · small sample'}
                  </div>
                </div>
                <div className="w-24">
                  <ScoreBar wins={n.wins} draws={n.draws} losses={n.losses} />
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ChoiceCard({ title, choices }: { title: string; choices: ReturnType<typeof openingChoices> }) {
  return (
    <Card>
      <div className="mb-3 text-sm font-semibold">{title}</div>
      {choices.length === 0 ? (
        <p className="text-sm text-muted">No games with this colour.</p>
      ) : (
        <ul className="space-y-2">
          {choices.map((c) => (
            <li key={c.line} className="flex items-center gap-3 text-sm">
              <span className="w-28 font-mono">{c.line}</span>
              <span className="w-16 text-xs text-muted">{plural(c.games, 'game')}</span>
              <span className={`text-xs tabular-nums ${c.score >= 0.5 ? 'text-accent' : 'text-bad'}`}>{pct(c.score)}</span>
              {c.games < 5 && <span className="text-[11px] text-muted">few games</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
