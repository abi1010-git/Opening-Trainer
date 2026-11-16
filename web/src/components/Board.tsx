import { useEffect, useMemo, useRef } from 'react';
import { Chess, SQUARES } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { DrawShape } from 'chessground/draw';
import type { Key } from 'chessground/types';
import type { Color } from '../lib/types';

export interface Arrow {
  uci: string;
  brush: 'green' | 'red' | 'blue' | 'yellow';
}

interface Props {
  fen: string;
  orientation: Color;
  arrows?: Arrow[];
  /** Last move in UCI, highlighted on the board. */
  lastMove?: string | null;
  /** If set, that side can move and `onMove` is called with the UCI of the move. */
  movable?: Color | null;
  onMove?: (uci: string) => void;
  viewOnly?: boolean;
  flash?: 'good' | 'bad' | null;
  coordinates?: boolean;
}

function legalDests(fen: string): Map<Key, Key[]> {
  const chess = new Chess(fen);
  const dests = new Map<Key, Key[]>();
  for (const sq of SQUARES) {
    const moves = chess.moves({ square: sq, verbose: true });
    if (moves.length) dests.set(sq as Key, moves.map((m) => m.to as Key));
  }
  return dests;
}

export default function Board({ fen, orientation, arrows = [], lastMove, movable, onMove, viewOnly, flash, coordinates = true }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const turn: Color = fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const dests = useMemo(() => (movable ? legalDests(fen) : new Map<Key, Key[]>()), [fen, movable]);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, {
      animation: { duration: 180 },
      highlight: { lastMove: true, check: true },
      drawable: { enabled: true, visible: true },
    });
    return () => api.current?.destroy();
  }, []);

  useEffect(() => {
    const shapes: DrawShape[] = arrows.map((a) => ({ orig: a.uci.slice(0, 2) as Key, dest: a.uci.slice(2, 4) as Key, brush: a.brush }));
    api.current?.set({
      fen,
      orientation,
      turnColor: turn,
      viewOnly: !!viewOnly,
      coordinates,
      lastMove: lastMove ? [lastMove.slice(0, 2) as Key, lastMove.slice(2, 4) as Key] : undefined,
      check: new Chess(fen).inCheck() ? turn : false,
      movable: {
        free: false,
        color: movable ?? undefined,
        dests,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const chess = new Chess(fen);
            const piece = chess.get(orig as never);
            const promotion = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : '';
            onMoveRef.current?.(`${orig}${dest}${promotion}`);
          },
        },
      },
      drawable: { autoShapes: shapes },
    });
  }, [fen, orientation, arrows, lastMove, movable, dests, turn, viewOnly, coordinates]);

  return (
    <div className={`board-frame rounded-md overflow-hidden ${flash === 'good' ? 'board-flash-good' : flash === 'bad' ? 'board-flash-bad' : ''}`}>
      <div ref={el} />
    </div>
  );
}
