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

function itemHTML(title, meta) {
  return `
    <div class="item">
      <div class="top">
        <div>${title}</div>
      </div>
      <div class="meta">${meta}</div>
    </div>
  `;
}

function renderList(container, items, onClick) {
  container.innerHTML = "";
  if (!items || items.length === 0) {
    container.innerHTML = `<div class="meta">No items yet.</div>`;
    return;
  }
  items.forEach((it) => {
    const title =
      it.opening
        ? `${it.opening} • ${it.mistake_type || it.label || "mistake"}`
        : `${it.mistake_type || it.label || "mistake"}`;

    const meta = [
      it.move_number ? `Move ${it.move_number} (${it.side})` : (it.ply ? `ply ${it.ply}` : null),
      `played ${it.move_uci}`,
      it.best_move_uci ? `best ${it.best_move_uci}` : (it.recommended_move_uci ? `best ${it.recommended_move_uci}` : null),
      (it.drop_pawns != null) ? `drop ${it.drop_pawns}` : (it.avg_drop_pawns != null ? `avg drop ${it.avg_drop_pawns}` : null),
      (it.count != null) ? `count ${it.count}` : null,
    ].filter(Boolean).join(" • ");

    const wrapper = document.createElement("div");
    wrapper.innerHTML = itemHTML(title, meta);
    const node = wrapper.firstElementChild;
    node.addEventListener("click", () => onClick(it));
    container.appendChild(node);
  });
}

async function analyze() {
  const username = document.getElementById("username").value.trim();
  const maxGames = document.getElementById("maxGames").value;
  const plies = document.getElementById("plies").value;
  const depth = document.getElementById("depth").value;

  const status = document.getElementById("status");
  status.textContent = "Analyzing… (leave the server running)";

  const url = `/lichess/${encodeURIComponent(username)}/opening_mistakes?max=${maxGames}&plies=${plies}&depth=${depth}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    status.textContent = `Done. Analyzed ${data.analyzed_games} games.`;

    const recurringList = document.getElementById("recurringList");
    const mistakeList = document.getElementById("mistakeList");
    const details = document.getElementById("details");

    // Flatten mistakes for "All mistakes"
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
      // recurring items use recommended_move_uci + fen_before
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

    // Put something on the board initially
    if (all.length > 0) {
      setBoard(all[0].fen_before, all[0].move_uci, all[0].best_move_uci);
    }
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  // Initialize chessboard
  const el = document.getElementById("board");
  ground = Chessground(el, {
    fen: "start",
    viewOnly: true,
    coordinates: true,
    drawable: { visible: true, enabled: true, autoShapes: [] },
  });

  document.getElementById("analyzeBtn").addEventListener("click", analyze);
});
