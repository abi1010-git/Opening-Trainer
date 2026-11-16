import { useMemo } from 'react';
import { moveLabel, pct, plural } from '../lib/format';
import { buildRepertoire, nodeScore, weakLines } from '../lib/repertoire';
import type { Card as SrsCard } from '../lib/srs';
import { dueCards } from '../lib/srs';
import type { Leak, Report } from '../lib/types';
import Board from './Board';
import { Button, Card, ColorDot, ScoreBar, SectionTitle, SeverityBadge, Stat } from './ui';

interface Props {
  report: Report;
  cards: Record<string, SrsCard>;
  onOpenLeak: (id: string) => void;
  onTrain: () => void;
  onRepertoire: () => void;
}

export default function Overview({ report, cards, onOpenLeak, onTrain, onRepertoire }: Props) {
  const games = report.games;
  const score = games.reduce((s, g) => s + (g.outcome === 'win' ? 1 : g.outcome === 'draw' ? 0.5 : 0), 0) / games.length;
  const mistakes = games.reduce((s, g) => s + g.mistakes.length, 0);
  const repeated = report.leaks.filter((l) => l.count >= 2);
  const due = dueCards(cards).length;
  const topLeaks: Leak[] = (repeated.length ? repeated : report.leaks).slice(0, 4);
  const cleanGames = games.filter((g) => g.mistakes.length === 0).length;
  const avgCheckedMove = Math.round(games.reduce((s, g) => s + g.analyzedPlies, 0) / games.length / 2);

  const weak = useMemo(() => {
    const white = weakLines(buildRepertoire(games, 'white'), 3, 3).map((n) => ({ n, color: 'white' as const }));
    const black = weakLines(buildRepertoire(games, 'black'), 3, 3).map((n) => ({ n, color: 'black' as const }));
    return [...white, ...black].sort((a, b) => b.n.games * (1 - nodeScore(b.n)) - a.n.games * (1 - nodeScore(a.n))).slice(0, 4);
  }, [games]);

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Games" value={games.length} hint={`${report.params.site === 'lichess' ? 'Lichess' : 'Chess.com'}`} />
        <Stat label="Score" value={pct(score)} hint="Wins + half of draws" tone={score >= 0.5 ? 'good' : 'bad'} />
        <Stat label="Opening mistakes" value={mistakes} hint={`${cleanGames} clean ${cleanGames === 1 ? 'game' : 'games'}`} />
        <Stat label="Repeated" value={repeated.length} hint="Same mistake, 2+ games" tone={repeated.length ? 'warn' : 'good'} />
        <Stat label="Drills due" value={due} hint={`${Object.keys(cards).length} positions total`} tone={due ? 'warn' : 'good'} />
      </div>

      <section>
        <SectionTitle
          title={repeated.length ? 'Mistakes you keep repeating' : 'Your costliest opening mistakes'}
          subtitle={repeated.length ? 'Same position, same wrong move, in more than one game.' : 'No repeats yet. Analyze more games to find patterns.'}
          action={
            due > 0 && (
              <Button onClick={onTrain}>
                Train {plural(due, 'position')}
              </Button>
            )
          }
        />
        {topLeaks.length === 0 ? (
          <Card className="text-sm text-muted">No opening mistakes found in these games. Nice!</Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {topLeaks.map((leak) => (
              <button key={leak.id} onClick={() => onOpenLeak(leak.id)} className="group text-left">
                <Card className="h-full p-3 transition group-hover:border-muted">
                  <Board
                    fen={leak.fenBefore}
                    orientation={leak.color}
                    viewOnly
                    coordinates={false}
                    arrows={[
                      { uci: leak.playedUci, brush: 'red' },
                      ...(leak.bestUci ? [{ uci: leak.bestUci, brush: 'green' as const }] : []),
                    ]}
                  />
                  <div className="mt-3 flex items-center gap-2">
                    <SeverityBadge severity={leak.severity} />
                    {leak.count > 1 && <span className="text-xs font-semibold text-warn">×{leak.count} games</span>}
                  </div>
                  <div className="mt-1.5 truncate text-xs text-muted" title={leak.opening}>
                    {leak.opening}
                  </div>
                  <div className="mt-1 text-sm">
                    You played <span className="font-semibold text-bad">{moveLabel(leak.moveNumber, leak.color, leak.playedSan)}</span>
                    {leak.bestSan && (
                      <>
                        {' '}
                        · better <span className="font-semibold text-accent">{leak.bestSan}</span>
                      </>
                    )}
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </section>

      {weak.length > 0 && (
        <section>
          <SectionTitle
            title="Lines that are costing you games"
            subtitle="Branches of your repertoire you reach often and score badly in."
            action={
              <Button variant="secondary" onClick={onRepertoire}>
                Open repertoire
              </Button>
            }
          />
          <div className="grid gap-3 md:grid-cols-2">
            {weak.map(({ n, color }) => (
              <Card key={color + n.path.join(' ')} className="flex items-center gap-4 p-4">
                <ColorDot color={color} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm">{formatLine(n.path)}</div>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-muted">
                    <span>{plural(n.games, 'game')}</span>
                    <span className="text-bad">{pct(nodeScore(n))} score</span>
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

      <section>
        <SectionTitle title="Openings" subtitle="How each opening is going for you, by the colour you played." />
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Opening</th>
                <th className="px-4 py-3 font-medium">Games</th>
                <th className="w-40 px-4 py-3 font-medium">Results</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Mistakes / game</th>
                <th className="px-4 py-3 font-medium">First mistake</th>
              </tr>
            </thead>
            <tbody>
              {report.openings.slice(0, 15).map((o) => (
                <tr key={o.color + o.name} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ColorDot color={o.color} />
                      <span className="truncate" title={o.name}>
                        {o.name}
                      </span>
                      {o.eco && <span className="text-xs text-muted">{o.eco}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{o.games}</td>
                  <td className="px-4 py-3">
                    <ScoreBar wins={o.wins} draws={o.draws} losses={o.losses} />
                  </td>
                  <td className={`px-4 py-3 tabular-nums ${o.score >= 0.5 ? 'text-accent' : 'text-bad'}`}>{pct(o.score)}</td>
                  <td className="px-4 py-3 tabular-nums">{(o.mistakes / o.games).toFixed(1)}</td>
                  <td className="px-4 py-3 tabular-nums text-muted">{o.avgFirstMistakeMove ? `move ${o.avgFirstMistakeMove}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <p className="text-center text-xs text-muted">
        {report.positionsEvaluated + report.cacheHits} positions checked in {(report.engineMs / 1000).toFixed(1)}s on your device
        {report.cacheHits > 0 && ` (${report.cacheHits} from cache)`} · depth {report.params.depth} · openings checked to move {avgCheckedMove} on average (stops 6 moves after theory ends)
      </p>
    </div>
  );
}

export function formatLine(path: string[]): string {
  return path.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
}
