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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatType(type) {
  return (type || "mistake").replace(":", " ");
}

function formatMove(san, uci) {
  if (san && uci) return `${san} (${uci})`;
  return san || uci || "n/a";
}

function plural(count, singular, pluralLabel = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function resultForUser(result, userColor) {
  if (result === "1/2-1/2") return "Draw";
  if (result === "1-0") return userColor === "White" ? "Win" : "Loss";
  if (result === "0-1") return userColor === "Black" ? "Win" : "Loss";
  return result || "Unknown result";
}

function gameLine(item) {
  const player = item.user_color === "White" ? item.white : item.user_color === "Black" ? item.black : "Player";
  return `Game ${item.game_number || "?"}: ${item.white || "White"} vs ${item.black || "Black"} - ` +
    `${player} as ${item.user_color || item.side || "player"} - ` +
    `${resultForUser(item.result, item.user_color)}`;
}

function renderEmpty(container, message) {
  container.replaceChildren(el("div", "empty", message));
}

function renderSummary(data, mistakes) {
  const summary = document.getElementById("summary");
  summary.replaceChildren();

  const stats = [
    ["Player", data.username],
    ["Games", data.analyzed_games],
    ["Mistakes", data.total_mistakes ?? mistakes.length],
    ["Recurring", data.recurring_mistake_count ?? (data.top_recurring_mistakes || []).length],
  ];

  for (const [label, value] of stats) {
    const item = el("div", "summaryItem");
    item.append(el("span", "summaryLabel", label), el("strong", null, value));
    summary.appendChild(item);
  }
}

function selectCard(card) {
  document.querySelectorAll(".item.selected").forEach((node) => node.classList.remove("selected"));
  card.classList.add("selected");
}

function detailRow(label, value) {
  const row = el("div", "detailRow");
  row.append(el("span", "detailLabel", label), el("span", "detailValue", value || "n/a"));
  return row;
}

function renderDetails(item, isRecurring = false) {
  const details = document.getElementById("details");
  details.replaceChildren();

  const title = isRecurring
    ? `${item.opening || item.eco || "Unknown opening"} - ${plural(item.count || 0, "time")}`
    : `${item.opening || item.eco || "Unknown opening"} - ${formatType(item.mistake_type)}`;

  details.appendChild(el("div", "detailsTitle", title));

  const grid = el("div", "detailGrid");
  if (isRecurring) {
    const example = (item.examples || [])[0] || {};
    grid.append(
      detailRow("Count", plural(item.count || 0, "time")),
      detailRow("Avg drop", `${item.avg_drop_pawns ?? "n/a"} pawns`),
      detailRow("Played", formatMove(item.move_san, item.move_uci)),
      detailRow("Recommended", formatMove(item.recommended_move_san, item.recommended_move_uci)),
      detailRow("Common opponent", item.common_opponent),
      detailRow("Example", gameLine(example))
    );
  } else {
    grid.append(
      detailRow("Game", gameLine(item)),
      detailRow("Move", `${item.move_number || "?"} as ${item.side || item.user_color || "player"}`),
      detailRow("Played", formatMove(item.move_san, item.move_uci)),
      detailRow("Recommended", formatMove(item.best_move_san, item.best_move_uci)),
      detailRow("Opponent reply", formatMove(item.best_reply_san, item.best_reply_uci)),
      detailRow("Drop", `${item.drop_pawns ?? "n/a"} pawns`),
      detailRow("Eval before", item.eval_before),
      detailRow("Eval after", item.eval_after)
    );
  }
  details.appendChild(grid);

  const pv = item.pv_before;
  if (pv && pv.length) {
    const pvLine = el("div", "pvLine", `PV: ${pv.join(" ")}`);
    details.appendChild(pvLine);
  }
}

function renderRecurring(container, items) {
  container.replaceChildren();
  if (!items || items.length === 0) {
    renderEmpty(container, "No recurring mistakes found.");
    return;
  }

  items.forEach((item) => {
    const card = el("button", "item", null);
    card.type = "button";

    const head = el("div", "itemHead");
    const titleBlock = el("div", "itemTitleBlock");
    titleBlock.append(
      el("div", "itemTitle", item.opening || item.eco || "Unknown opening"),
      el("div", "itemSub", `${formatType(item.mistake_type)} - ${item.common_opponent ? `often vs ${item.common_opponent}` : "opening position"}`)
    );

    const count = el("div", "countBadge");
    count.append(el("strong", null, item.count ?? 0), el("span", null, item.count === 1 ? "time" : "times"));
    head.append(titleBlock, count);

    const stats = el("div", "statRow");
    stats.append(
      el("span", "stat danger", `avg drop ${item.avg_drop_pawns}`),
      el("span", "stat", `played ${formatMove(item.move_san, item.move_uci)}`),
      el("span", "stat good", `best ${formatMove(item.recommended_move_san, item.recommended_move_uci)}`)
    );

    const example = (item.examples || [])[0];
    if (example) card.append(head, stats, el("div", "gameMeta", gameLine(example)));
    else card.append(head, stats);

    card.addEventListener("click", () => {
      selectCard(card);
      setBoard(item.fen_before, item.move_uci, item.recommended_move_uci);
      renderDetails(item, true);
    });
    container.appendChild(card);
  });
}

function renderMistakes(container, items) {
  container.replaceChildren();
  if (!items || items.length === 0) {
    renderEmpty(container, "No opening mistakes found for this player.");
    return;
  }

  items.forEach((item) => {
    const card = el("button", "item", null);
    card.type = "button";

    const head = el("div", "itemHead");
    const titleBlock = el("div", "itemTitleBlock");
    titleBlock.append(
      el("div", "itemTitle", `${item.opening || item.eco || "Unknown opening"} - ${formatType(item.mistake_type)}`),
      el("div", "itemSub", gameLine(item))
    );

    const moveBadge = el("div", "moveBadge");
    moveBadge.append(el("span", null, "Move"), el("strong", null, item.move_number || "?"));
    head.append(titleBlock, moveBadge);

    const stats = el("div", "statRow");
    stats.append(
      el("span", "stat", `played ${formatMove(item.move_san, item.move_uci)}`),
      el("span", "stat good", `best ${formatMove(item.best_move_san, item.best_move_uci)}`),
      el("span", "stat danger", `drop ${item.drop_pawns}`)
    );

    card.append(head, stats);
    card.addEventListener("click", () => {
      selectCard(card);
      setBoard(item.fen_before, item.move_uci, item.best_move_uci);
      renderDetails(item);
    });
    container.appendChild(card);
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

    const all = [];
    for (const g of data.games || []) {
      for (const m of (g.mistakes || [])) {
        all.push({
          ...m,
          opening: g.opening || g.eco || "Unknown",
          eco: g.eco,
          white: g.white,
          black: g.black,
          opponent: g.opponent,
          user_color: g.user_color,
          result: g.result,
          date: g.date,
          site: g.site,
        });
      }
    }

    status.textContent = `Done. ${data.username} made ${plural(all.length, "opening mistake")} in ${plural(data.analyzed_games, "game")}.`;
    renderSummary(data, all);
    renderRecurring(document.getElementById("recurringList"), data.top_recurring_mistakes || []);
    renderMistakes(document.getElementById("mistakeList"), all);

    const first = all[0];
    if (first) {
      setBoard(first.fen_before, first.move_uci, first.best_move_uci);
      renderDetails(first);
    } else {
      document.getElementById("details").textContent = "No mistakes found for this player.";
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
