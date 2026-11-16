import { del, get, set } from 'idb-keyval';
import type { Card } from './srs';
import type { AnalysisParams, Report } from './types';

/** Everything lives in the browser: no accounts, no server, nothing to pay for. */

const REPORT_KEY = 'ot.report.v1';
const CARDS_KEY = 'ot.cards.v1';
const PARAMS_KEY = 'ot.params.v1';

export async function loadReport(): Promise<Report | null> {
  try {
    const report = await get<Report>(REPORT_KEY);
    // Reports saved by older versions of the app have a different shape; re-analysing is quick.
    return report?.version === 3 ? report : null;
  } catch {
    return null;
  }
}

export async function saveReport(report: Report) {
  try {
    await set(REPORT_KEY, report);
  } catch {
    // Storage unavailable: the report still works for this visit.
  }
}

export async function clearReport() {
  try {
    await del(REPORT_KEY);
  } catch {
    /* ignore */
  }
}

/** Drills are kept per account, so trying a friend's username doesn't mix their positions into yours. */
export function cardOwner(p: Pick<AnalysisParams, 'site' | 'username'>): string {
  return `${p.site}:${p.username.trim().toLowerCase()}`;
}

export function loadCards(owner: string): Record<string, Card> {
  try {
    return JSON.parse(localStorage.getItem(`${CARDS_KEY}.${owner}`) ?? '{}');
  } catch {
    return {};
  }
}

export function saveCards(owner: string, cards: Record<string, Card>) {
  try {
    localStorage.setItem(`${CARDS_KEY}.${owner}`, JSON.stringify(cards));
  } catch {
    /* ignore */
  }
}

export function loadParams(): Partial<AnalysisParams> {
  try {
    return JSON.parse(localStorage.getItem(PARAMS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function saveParams(p: AnalysisParams) {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
