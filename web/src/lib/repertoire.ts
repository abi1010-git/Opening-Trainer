import type { AnalyzedGame, Color } from './types';

/** Your de-facto repertoire: a move tree built from the games you actually played. */
export interface RepNode {
  san: string;
  ply: number;
  path: string[];
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** How many times you made a mistake with this exact move. */
  mistakes: number;
  isUserMove: boolean;
  children: RepNode[];
}

export function buildRepertoire(games: AnalyzedGame[], color: Color, depth = 10): RepNode {
  const root: RepNode = { san: '', ply: 0, path: [], games: 0, wins: 0, draws: 0, losses: 0, mistakes: 0, isUserMove: false, children: [] };
  for (const g of games) {
    if (g.userColor !== color) continue;
    const mistakePlies = new Set(g.mistakes.map((m) => m.ply));
    let node = root;
    bump(node, g);
    for (let i = 0; i < Math.min(depth, g.moves.length); i++) {
      const san = g.moves[i];
      let child = node.children.find((c) => c.san === san);
      if (!child) {
        child = {
          san,
          ply: i + 1,
          path: [...node.path, san],
          games: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          mistakes: 0,
          isUserMove: (i % 2 === 0) === (color === 'white'),
          children: [],
        };
        node.children.push(child);
      }
      bump(child, g);
      if (mistakePlies.has(i + 1)) child.mistakes++;
      node = child;
    }
  }
  sortTree(root);
  return root;
}

function bump(node: RepNode, g: AnalyzedGame) {
  node.games++;
  if (g.outcome === 'win') node.wins++;
  else if (g.outcome === 'draw') node.draws++;
  else node.losses++;
}

function sortTree(node: RepNode) {
  node.children.sort((a, b) => b.games - a.games);
  node.children.forEach(sortTree);
}

export function nodeScore(n: RepNode): number {
  return n.games ? (n.wins + n.draws / 2) / n.games : 0;
}

/**
 * Lines you play often and score badly in: the best places to spend study time.
 * Only counts branches reached in at least `minGames` games.
 */
export function weakLines(root: RepNode, minGames = 3, limit = 5): RepNode[] {
  const out: RepNode[] = [];
  const walk = (n: RepNode) => {
    if (n.ply >= 2 && n.games >= minGames && nodeScore(n) < 0.45) out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  // Prefer the deepest weak node on a path (more specific), then the most games.
  const specific = out.filter((n) => !out.some((o) => o !== n && o.path.length > n.path.length && n.path.every((s, i) => o.path[i] === s) && o.games >= n.games * 0.75));
  return specific.sort((a, b) => b.games * (1 - nodeScore(b)) - a.games * (1 - nodeScore(a))).slice(0, limit);
}
