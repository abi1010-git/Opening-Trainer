import { Chessground } from "https://unpkg.com/chessground@9.1.1/dist/chessground.min.js";

let ground = null;

function uciToArrow(uci) {
  if (!uci || uci.length < 4) return null;
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  return [from, to];
}

function setBoard(fen, playedUci, bestUci) {
  const played = uciToArrow(playedUci);
  const best = uciToArrow(bestUci);

  const shapes = [];
  if (played) shapes.push({ orig: played[0], dest: played[1], brush: "red" });
  if (best) shapes.push({ orig: best[0], dest: best[1], brush: "green" });

  ground.set({
    fen,
    viewOnly: true,
    drawable: {
      visible: true,
      enabled: true,
      autoShapes: shapes,
    },
  });
}

function renderEmpty(container) {
  const empty = document.createElement("div");
  empty.className = "meta";
  empty.textContent = "No items yet.";
  container.appendChild(empty);
}

function renderList(container, items, onClick) {
  container.replaceChildren();
  if (!items || items.length === 0) {
    renderEmpty(container);
    return;
  }

  items.forEach((it) => {
    const title = it.opening
      ? `${it.opening} - ${it.mistake_type || it.label || "mistake"}`
      : `${it.mistake_type || it.label || "mistake"}`;

    const meta = [
      it.move_number ? `Move ${it.move_number} (${it.side})` : (it.ply ? `ply ${it.ply}` : null),
      `played ${it.move_uci}`,
      it.best_move_uci ? `best ${it.best_move_uci}` : (it.recommended_move_uci ? `best ${it.recommended_move_uci}` : null),
      (it.drop_pawns != null) ? `drop ${it.drop_pawns}` : (it.avg_drop_pawns != null ? `avg drop ${it.avg_drop_pawns}` : null),
      (it.count != null) ? `count ${it.count}` : null,
    ].filter(Boolean).join(" - ");

    const node = document.createElement("div");
    node.className = "item";

    const top = document.createElement("div");
    top.className = "top";

    const titleEl = document.createElement("div");
    titleEl.textContent = title;

    const metaEl = document.createElement("div");
    metaEl.className = "meta";
    metaEl.textContent = meta;

    top.appendChild(titleEl);
    node.append(top, metaEl);
    node.addEventListener("click", () => onClick(it));
    container.appendChild(node);
  });
}

async function parseApiResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const text = await res.text();
  const title = text.match(/<title>(.*?)<\/title>/i)?.[1]?.trim();
  const preview = title || text.replace(/\s+/g, " ").slice(0, 120);
  throw new Error(
    `The analysis server returned a web page instead of data (${res.status}). ` +
    `${preview}. Use the Flask/Render app URL, not GitHub Pages or a raw HTML file.`
  );
}

async function analyze() {
  const username = document.getElementById("username").value.trim();
  const maxGames = document.getElementById("maxGames").value;
  const plies = document.getElementById("plies").value;
  const depth = document.getElementById("depth").value;

  const status = document.getElementById("status");
  if (!username) {
    status.textContent = "Enter a Lichess username first.";
    return;
  }

  status.textContent = "Analyzing... (leave the server running)";

  const url = `/lichess/${encodeURIComponent(username)}/opening_mistakes?max=${maxGames}&plies=${plies}&depth=${depth}`;

  try {
    const res = await fetch(url);
    const data = await parseApiResponse(res);

    status.textContent = `Done. Analyzed ${data.analyzed_games} games.`;

    const recurringList = document.getElementById("recurringList");
    const mistakeList = document.getElementById("mistakeList");
    const details = document.getElementById("details");

    const all = [];
    for (const g of data.games || []) {
      for (const m of (g.mistakes || [])) {
        all.push({
          ...m,
          opening: g.opening || g.eco || "Unknown",
        });
      }
    }

    renderList(recurringList, data.top_recurring_mistakes || [], (it) => {
      setBoard(it.fen_before, it.move_uci, it.recommended_move_uci);
      details.textContent =
        `Opening: ${it.opening}\n` +
        `Played: ${it.move_uci}\n` +
        `Recommended: ${it.recommended_move_uci}\n` +
        `Count: ${it.count}\n` +
        `Avg drop: ${it.avg_drop_pawns}\n` +
        (it.pv_before ? `PV: ${it.pv_before.join(" ")}` : "");
    });

    renderList(mistakeList, all, (it) => {
      setBoard(it.fen_before, it.move_uci, it.best_move_uci);
      details.textContent =
        `Opening: ${it.opening}\n` +
        `ply: ${it.ply}\n` +
        `Played: ${it.move_uci}\n` +
        `Recommended: ${it.best_move_uci}\n` +
        `Best reply: ${it.best_reply_uci}\n` +
        `Type: ${it.mistake_type}\n` +
        `Eval before: ${it.eval_before}\n` +
        `Eval after: ${it.eval_after}\n` +
        `Drop: ${it.drop_pawns}\n` +
        (it.mate_after != null ? `Mate after: ${it.mate_after}\n` : "") +
        (it.pv_before ? `PV: ${it.pv_before.join(" ")}` : "");
    });

    if (all.length > 0) {
      setBoard(all[0].fen_before, all[0].move_uci, all[0].best_move_uci);
    }
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("board");
  ground = Chessground(el, {
    fen: "start",
    viewOnly: true,
    coordinates: true,
    drawable: { visible: true, enabled: true, autoShapes: [] },
  });

  document.getElementById("analyzeBtn").addEventListener("click", analyze);
});
