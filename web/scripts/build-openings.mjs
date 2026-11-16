// Turns data/openings.csv (ECO lines) into a position-keyed lookup table used by the browser.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const csv = readFileSync(join(root, '..', 'data', 'openings.csv'), 'utf8');

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const table = {};
let skipped = 0;
const lines = csv.split(/\r?\n/).slice(1).filter(Boolean);
for (const line of lines) {
  const [eco, rawName, moves] = parseCsvLine(line).map((s) => (s ?? '').trim());
  if (!eco || !rawName || !moves) continue;
  const name = rawName.replace(/;$/, '').replace(new RegExp(`(?:\s*;\s*|\s+)${eco}$`), '').trim();
  const chess = new Chess();
  try {
    for (const token of moves.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean)) {
      chess.move(token.replace(/0-0/g, 'O-O'));
    }
  } catch {
    skipped++;
    continue;
  }
  const key = chess.fen().split(' ').slice(0, 4).join(' ');
  const plies = chess.history().length;
  // Keep the shortest line that reaches a position: it is the canonical name for it.
  if (!table[key] || table[key][2] > plies) table[key] = [eco, name, plies, chess.history().join(' ')];
}

mkdirSync(join(root, 'src', 'generated'), { recursive: true });
writeFileSync(join(root, 'src', 'generated', 'openings.json'), JSON.stringify(table));
console.log(`Built ${Object.keys(table).length} opening positions (${skipped} unparsable rows skipped)`);
