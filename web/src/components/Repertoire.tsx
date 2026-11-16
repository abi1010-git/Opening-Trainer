import { useMemo, useState } from 'react';
import { positionsFor } from '../lib/analysis';
import { pct, plural } from '../lib/format';
import { buildRepertoire, nodeScore, weakLines, type RepNode } from '../lib/repertoire';
import type { Color, Report } from '../lib/types';
import Board from './Board';
import { formatLine } from './Overview';
import { Card, cx, Empty, ScoreBar, Segmented } from './ui';

export default function Repertoire({ report }: { report: Report }) {
  const counts = { white: report.games.filter((g) => g.userColor === 'white').length, black: report.games.filter((g) => g.userColor === 'black').length };
  const [color, setColor] = useState<Color>(counts.white >= counts.black ? 'white' : 'black');
  const [path, setPath] = useState<string[]>([]);
  const root = useMemo(() => buildRepertoire(report.games, color, 12), [report.games, color]);
  const weak = useMemo(() => new Set(weakLines(root, 3, 8).map((n) => n.path.join(' '))), [root]);
  const { fens, ucis } = useMemo(() => positionsFor(path, path.length), [path]);

  const switchColor = (c: Color) => {
    setColor(c);
    setPath([]);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Board fen={fens[fens.length - 1]} orientation={color} viewOnly lastMove={ucis[ucis.length - 1] ?? null} />
        <div className="mt-3 min-h-6 font-mono text-sm text-muted">{path.length ? formatLine(path) : 'Starting position. Click a move to explore.'}</div>
      </div>

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented<Color>
            label="Colour"
            value={color}
            onChange={switchColor}
            options={[
              { value: 'white', label: `As White (${counts.white})` },
              { value: 'black', label: `As Black (${counts.black})` },
            ]}
          />
          <div className="flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-accent" /> your move
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-bad" /> weak line
            </span>
          </div>
        </div>
        {root.games === 0 ? (
          <Empty title={`No games as ${color}`}>Analyze more games to see this side of your repertoire.</Empty>
        ) : (
          <Card className="p-2">
            <Tree node={root} depth={0} selected={path} onSelect={setPath} weak={weak} />
          </Card>
        )}
        <p className="mt-3 text-xs text-muted">
          Built from the moves you actually played, not a book. Lines you reach in 3+ games and score under 45% in are marked as weak.
        </p>
      </div>
    </div>
  );
}

function Tree({ node, depth, selected, onSelect, weak }: { node: RepNode; depth: number; selected: string[]; onSelect: (p: string[]) => void; weak: Set<string> }) {
  const [showRare, setShowRare] = useState(false);
  const common = node.children.filter((c) => c.games >= 2 || node.children.length === 1);
  const rare = node.children.filter((c) => !common.includes(c));
  const visible = showRare ? node.children : common;

  return (
    <ul className={cx(depth > 0 && 'ml-3 border-l border-line pl-2')}>
      {visible.map((child) => (
        <Branch key={child.san} node={child} depth={depth} selected={selected} onSelect={onSelect} weak={weak} />
      ))}
      {rare.length > 0 && !showRare && (
        <li>
          <button onClick={() => setShowRare(true)} className="px-2 py-1 text-xs text-muted hover:text-text">
            + {plural(rare.length, 'rare move')} ({rare.reduce((s, c) => s + c.games, 0)} games)
          </button>
        </li>
      )}
    </ul>
  );
}

function Branch({ node, depth, selected, onSelect, weak }: { node: RepNode; depth: number; selected: string[]; onSelect: (p: string[]) => void; weak: Set<string> }) {
  const onPath = node.path.every((s, i) => selected[i] === s);
  const isSelected = onPath && selected.length === node.path.length;
  const [open, setOpen] = useState(depth < 3);
  const expanded = open || (onPath && selected.length > node.path.length);
  const score = nodeScore(node);
  const isWeak = weak.has(node.path.join(' '));
  const moveNo = Math.floor((node.ply - 1) / 2) + 1;

  return (
    <li>
      <div
        className={cx(
          'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
          isSelected ? 'bg-accent/10' : 'hover:bg-panel-2',
        )}
      >
        <button
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(!expanded)}
          className={cx('w-4 text-xs text-muted', !node.children.length && 'invisible')}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button onClick={() => onSelect(node.path)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className={cx('font-mono', node.isUserMove ? 'font-semibold text-text' : 'text-muted')}>
            {node.ply % 2 === 1 ? `${moveNo}.` : `${moveNo}…`}
            {node.san}
          </span>
          {node.isUserMove && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
          {isWeak && <span className="rounded bg-bad/15 px-1.5 py-0.5 text-[10px] font-semibold text-bad">weak</span>}
          {node.mistakes > 0 && <span className="text-[11px] text-warn">{plural(node.mistakes, 'mistake')}</span>}
        </button>
        <span className="w-14 text-right text-xs tabular-nums text-muted">{plural(node.games, 'game')}</span>
        <div className="hidden w-20 sm:block">
          <ScoreBar wins={node.wins} draws={node.draws} losses={node.losses} />
        </div>
        <span className={cx('w-10 text-right text-xs tabular-nums', score >= 0.5 ? 'text-accent' : 'text-bad')}>{pct(score)}</span>
      </div>
      {expanded && node.children.length > 0 && <Tree node={node} depth={depth + 1} selected={selected} onSelect={onSelect} weak={weak} />}
    </li>
  );
}
