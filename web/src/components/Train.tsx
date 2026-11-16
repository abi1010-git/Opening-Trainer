import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { evalToPawns } from '../lib/analysis';
import { sharedEngine } from '../lib/engine';
import { plural } from '../lib/format';
import { dueCards, masteryCounts, nextDue, review, type Card as SrsCard } from '../lib/srs';
import Board, { type Arrow } from './Board';
import { Button, Card, Empty } from './ui';

interface Props {
  cards: Record<string, SrsCard>;
  onUpdate: (card: SrsCard) => void;
  depth: number;
}

type Feedback =
  | { kind: 'correct'; text: string; uci: string }
  | { kind: 'alternative'; text: string; uci: string }
  | { kind: 'wrong'; text: string; uci: string }
  | { kind: 'revealed' }
  | { kind: 'checking'; uci: string };

/** A move this close to the engine's choice still counts as right. */
const ALTERNATIVE_TOLERANCE_PAWNS = 0.3;

export default function Train({ cards, onUpdate, depth }: Props) {
  const [queue, setQueue] = useState<string[]>(() => dueCards(cards).map((c) => c.id));
  const [pos, setPos] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [tally, setTally] = useState({ right: 0, wrong: 0 });
  const checkId = useRef(0);

  const card = queue[pos] ? cards[queue[pos]] : null;
  const counts = masteryCounts(cards);

  const restart = (all = false) => {
    const list = all ? Object.values(cards).sort((a, b) => b.lapses - a.lapses || b.timesPlayed - a.timesPlayed) : dueCards(cards);
    setQueue(list.map((c) => c.id));
    setPos(0);
    setFeedback(null);
    setTally({ right: 0, wrong: 0 });
  };

  const grade = useCallback(
    (correct: boolean) => {
      if (!card) return;
      onUpdate(review(card, correct));
      setTally((t) => (correct ? { ...t, right: t.right + 1 } : { ...t, wrong: t.wrong + 1 }));
    },
    [card, onUpdate],
  );

  const next = useCallback(() => {
    setFeedback(null);
    setPos((p) => p + 1);
  }, []);

  const onMove = async (uci: string) => {
    if (!card || feedback) return;
    if (uci === card.answerUci || uci.slice(0, 4) === card.answerUci.slice(0, 4)) {
      setFeedback({ kind: 'correct', text: `Correct: ${card.answerSan}`, uci });
      grade(true);
      return;
    }
    // Not the engine's first choice: check whether it's just as good before marking it wrong.
    const id = ++checkId.current;
    setFeedback({ kind: 'checking', uci });
    const chess = new Chess(card.fen);
    let san = uci;
    try {
      san = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    } catch {
      setFeedback(null);
      return;
    }
    let ok = false;
    try {
      const engine = sharedEngine();
      const [before, after] = await Promise.all([engine.evaluate(card.fen, depth), engine.evaluate(chess.fen(), depth)]);
      const sign = card.color === 'white' ? 1 : -1;
      ok = (evalToPawns(before) - evalToPawns(after)) * sign <= ALTERNATIVE_TOLERANCE_PAWNS;
    } catch {
      ok = false;
    }
    if (id !== checkId.current) return;
    if (ok) {
      setFeedback({ kind: 'alternative', text: `${san} works too. The engine's top choice was ${card.answerSan}.`, uci });
      grade(true);
    } else {
      const repeated = card.playedSan.includes(san);
      setFeedback({
        kind: 'wrong',
        text: repeated ? `${san} is the move you keep playing here. The right move is ${card.answerSan}.` : `${san} isn't it. The right move is ${card.answerSan}.`,
        uci,
      });
      grade(false);
    }
  };

  const reveal = () => {
    if (!card || feedback) return;
    setFeedback({ kind: 'revealed' });
    grade(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && feedback && feedback.kind !== 'checking') {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [feedback, next]);

  const arrows = useMemo<Arrow[]>(() => {
    if (!card || !feedback || feedback.kind === 'checking') return [];
    if (feedback.kind === 'correct') return [{ uci: card.answerUci, brush: 'green' }];
    if (feedback.kind === 'alternative') return [{ uci: feedback.uci, brush: 'green' }, { uci: card.answerUci, brush: 'blue' }];
    if (feedback.kind === 'wrong') return [{ uci: feedback.uci, brush: 'red' }, { uci: card.answerUci, brush: 'green' }];
    return [{ uci: card.answerUci, brush: 'green' }];
  }, [card, feedback]);

  if (counts.total === 0) {
    return <Empty title="No drills yet">Analyze your games first. Every opening mistake becomes a position to practise here.</Empty>;
  }

  if (!card) {
    const upcoming = nextDue(cards);
    return (
      <div className="mx-auto max-w-lg">
        <Card className="space-y-4 py-10 text-center">
          <div className="text-4xl">✓</div>
          <div className="text-lg font-semibold">{tally.right + tally.wrong ? 'Session complete' : 'All caught up'}</div>
          {tally.right + tally.wrong > 0 && (
            <p className="text-sm text-muted">
              {tally.right} right, {tally.wrong} to revisit. Missed positions come back in 10 minutes.
            </p>
          )}
          <p className="text-sm text-muted">
            {upcoming ? `Next review ${relativeTime(upcoming)}.` : ''} {counts.mastered} of {counts.total} positions mastered.
          </p>
          <div className="flex justify-center gap-2">
            {dueCards(cards).length > 0 && <Button onClick={() => restart()}>Review {dueCards(cards).length} due</Button>}
            <Button variant="secondary" onClick={() => restart(true)}>
              Practise all anyway
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const done = feedback && feedback.kind !== 'checking';
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <div>
        <Board
          key={card.id}
          fen={card.fen}
          orientation={card.color}
          movable={feedback ? null : card.color}
          onMove={onMove}
          arrows={arrows}
          flash={feedback?.kind === 'correct' || feedback?.kind === 'alternative' ? 'good' : feedback?.kind === 'wrong' || feedback?.kind === 'revealed' ? 'bad' : null}
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Position {pos + 1} of {queue.length}
          </span>
          <span className="tabular-nums">
            <span className="text-accent">{tally.right} ✓</span> · <span className="text-bad">{tally.wrong} ✗</span>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div className="h-full bg-accent transition-all" style={{ width: `${(pos / queue.length) * 100}%` }} />
        </div>

        <Card className="space-y-3">
          <div className="text-xs text-muted">{card.opening}</div>
          <div className="text-lg font-semibold">Find the best move for {card.color}</div>
          <p className="text-sm text-muted">
            You went wrong here in {plural(card.timesPlayed, 'game')}
            {card.playedSan.length ? ` (you played ${card.playedSan.join(', ')})` : ''}.
            {card.reps > 0 && ` Reviewed ${plural(card.reps, 'time')} in a row correctly.`}
          </p>

          {feedback?.kind === 'checking' && <p className="text-sm text-muted">Checking your move…</p>}
          {feedback && feedback.kind !== 'checking' && (
            <div
              className={
                feedback.kind === 'correct' || feedback.kind === 'alternative'
                  ? 'rounded-lg bg-accent/10 p-3 text-sm text-accent'
                  : 'rounded-lg bg-bad/10 p-3 text-sm text-bad'
              }
            >
              {feedback.kind === 'revealed' ? `The right move is ${card.answerSan}.` : feedback.text}
              {(feedback.kind === 'wrong' || feedback.kind === 'revealed') && <div className="mt-1 text-xs text-muted">This one comes back in 10 minutes.</div>}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            {done ? (
              <Button onClick={next} className="flex-1">
                Next position ↵
              </Button>
            ) : (
              <Button variant="secondary" onClick={reveal} className="flex-1" disabled={feedback?.kind === 'checking'}>
                Show answer
              </Button>
            )}
          </div>
        </Card>

        <p className="text-xs text-muted">
          Drag a piece to answer. Any move within {ALTERNATIVE_TOLERANCE_PAWNS} pawns of the engine's choice counts. Correct answers come back after
          1, 3, then about 8 days, getting longer each time.
        </p>
      </div>
    </div>
  );
}

function relativeTime(ts: number): string {
  const mins = Math.round((ts - Date.now()) / 60000);
  if (mins < 60) return `in ${Math.max(1, mins)} min`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}
