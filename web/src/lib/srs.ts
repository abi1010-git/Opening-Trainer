import type { Color, Leak } from './types';

/**
 * Spaced repetition for your own mistakes (a simplified SM-2, the algorithm behind Anki).
 * One card per position: you only need to learn the right move once, even if you played
 * several different wrong moves there.
 */
export interface Card {
  id: string;
  fen: string;
  color: Color;
  answerUci: string;
  answerSan: string;
  /** Wrong moves you've played here, most common first. */
  playedSan: string[];
  opening: string;
  timesPlayed: number;
  evalBefore?: number;
  due: number;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewed?: number;
}

const DAY = 24 * 60 * 60 * 1000;
const RETRY_DELAY = 10 * 60 * 1000;

export function cardsFromLeaks(leaks: Leak[], existing: Record<string, Card>, now = Date.now()): Record<string, Card> {
  const byPosition = new Map<string, Leak[]>();
  for (const leak of leaks) {
    if (!leak.bestUci || !leak.bestSan) continue;
    byPosition.set(leak.positionKey, [...(byPosition.get(leak.positionKey) ?? []), leak]);
  }

  const next: Record<string, Card> = { ...existing };
  for (const [id, list] of byPosition) {
    const top = list[0];
    const prev = existing[id];
    const info = {
      answerUci: top.bestUci!,
      answerSan: top.bestSan!,
      playedSan: [...new Set([...list.map((l) => l.playedSan), ...(prev?.playedSan ?? [])])],
      opening: top.opening,
      timesPlayed: list.reduce((s, l) => s + l.count, 0),
    };
    // Re-analysing keeps your review schedule; it only refreshes what we know about the position.
    next[id] = prev
      ? { ...prev, ...info }
      : { id, fen: top.fenBefore, color: top.color, ...info, due: now, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 };
  }
  return next;
}

export function review(card: Card, correct: boolean, now = Date.now()): Card {
  if (!correct) {
    return {
      ...card,
      reps: 0,
      lapses: card.lapses + 1,
      intervalDays: 0,
      ease: Math.max(1.3, card.ease - 0.2),
      due: now + RETRY_DELAY,
      lastReviewed: now,
    };
  }
  const reps = card.reps + 1;
  const intervalDays = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(card.intervalDays * card.ease);
  return {
    ...card,
    reps,
    intervalDays,
    ease: Math.min(3, card.ease + 0.05),
    due: now + intervalDays * DAY,
    lastReviewed: now,
  };
}

/** Due cards, most-repeated mistakes first so the biggest leaks get fixed first. */
export function dueCards(cards: Record<string, Card>, now = Date.now()): Card[] {
  return Object.values(cards)
    .filter((c) => c.due <= now)
    .sort((a, b) => a.reps - b.reps || b.timesPlayed - a.timesPlayed || a.due - b.due);
}

export function nextDue(cards: Record<string, Card>, now = Date.now()): number | null {
  const future = Object.values(cards).filter((c) => c.due > now).map((c) => c.due);
  return future.length ? Math.min(...future) : null;
}

export function masteryCounts(cards: Record<string, Card>) {
  const list = Object.values(cards);
  return {
    total: list.length,
    learning: list.filter((c) => c.reps > 0 && c.intervalDays < 7).length,
    mastered: list.filter((c) => c.intervalDays >= 7).length,
    fresh: list.filter((c) => c.reps === 0 && c.lapses === 0).length,
  };
}
