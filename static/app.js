import { Chessground } from "https://unpkg.com/chessground@9.1.1/dist/chessground.min.js";

let ground = null;
let gameIndex = new Map();
let currentReview = null;

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

function hideMoveViewer() {
  currentReview = null;
  const viewer = document.getElementById("moveViewer");
  if (viewer) viewer.hidden = true;
}

function reviewSource(item, isRecurring = false) {
  const example = isRecurring ? ((item.examples || [])[0] || {}) : item;
  const gameNumber = example.game_number || item.game_number;
  const game = gameIndex.get(Number(gameNumber)) || gameIndex.get(gameNumber);
  const history = game?.move_history || [];
  const mistakeIndex = Number(example.history_index ?? item.history_index ?? 0) || 0;
  const bestUci = item.best_move_uci || item.recommended_move_uci ||
    example.best_move_uci || example.recommended_move_uci;

  return {
    history,
    mistakeIndex,
    playedUci: item.move_uci || example.move_uci,
    bestUci,
    fallbackFen: item.fen_before || example.fen_before,
    gameDescription: game ? gameLine(game) : gameLine(example),
  };
}

function showHistoryPosition(index) {
  if (!currentReview || !currentReview.history.length) return;

  const history = currentReview.history;
  const safeIndex = Math.max(0, Math.min(history.length - 1, Number(index) || 0));
  const position = history[safeIndex];
  const onMistake = safeIndex === currentReview.mistakeIndex;

  currentReview.positionIndex = safeIndex;
  document.getElementById("moveSelect").value = String(safeIndex);
  document.getElementById("moveSlider").value = String(safeIndex);
  document.getElementById("prevMoveBtn").disabled = safeIndex <= 0;
  document.getElementById("nextMoveBtn").disabled = safeIndex >= history.length - 1;

  setBoard(
    position.fen,
    onMistake ? currentReview.playedUci : null,
    onMistake ? currentReview.bestUci : null
  );

  const moveText = safeIndex === 0 ? "Start position" : `After ${position.label}`;
  const arrowText = onMistake ? " - arrows show played vs recommended" : "";
  document.getElementById("moveViewerMeta").textContent =
    `${moveText} - ${currentReview.gameDescription}${arrowText}`;
}

function renderMoveViewer(item, isRecurring = false) {
  const viewer = document.getElementById("moveViewer");
  const select = document.getElementById("moveSelect");
  const slider = document.getElementById("moveSlider");
  const source = reviewSource(item, isRecurring);

  if (!source.history.length) {
    hideMoveViewer();
    if (source.fallbackFen) setBoard(source.fallbackFen, source.playedUci, source.bestUci);
    return;
  }

  select.replaceChildren();
  source.history.forEach((position, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = position.label || `Move ${index}`;
    select.appendChild(option);
  });

  currentReview = source;
  viewer.hidden = false;
  slider.min = "0";
  slider.max = String(source.history.length - 1);
  showHistoryPosition(source.mistakeIndex);
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
  const timeControl = item.time_control ? ` - ${item.time_control}` : "";
  return `Game ${item.game_number || "?"}: ${item.white || "White"} vs ${item.black || "Black"} - ` +
    `${player} as ${item.user_color || item.side || "player"} - ` +
    `${resultForUser(item.result, item.user_color)}${timeControl}`;
}

function renderEmpty(container, message) {
  container.replaceChildren(el("div", "empty", message));
}

function renderSummary(data, mistakes) {
  const summary = document.getElementById("summary");
  summary.replaceChildren();

  const filter = data.params?.time_mode && data.params.time_mode !== "all"
    ? `${data.params.time_mode} ${(data.params.time_controls || []).join(", ")}`
    : "All";

  const stats = [
    ["Player", data.username],
    ["Target", data.requested_games ?? data.params?.max ?? data.analyzed_games],
    ["Analyzed", data.analyzed_games],
    ["Scanned", data.scanned_games ?? data.fetched_games ?? data.analyzed_games],
    ["Skipped", data.skipped_games ?? 0],
    ["Mistakes", data.total_mistakes ?? mistakes.length],
    ["Recurring", data.recurring_mistake_count ?? (data.top_recurring_mistakes || []).length],
    ["Time filter", filter],
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
      detailRow("Opening line", item.opening_moves || example.opening_moves),
      detailRow("Common opponent", item.common_opponent),
      detailRow("Time control", example.time_control),
      detailRow("Example", gameLine(example))
    );
  } else {
    grid.append(
      detailRow("Game", gameLine(item)),
      detailRow("Time control", item.time_control),
      detailRow("Move", `${item.move_number || "?"} as ${item.side || item.user_color || "player"}`),
      detailRow("Played", formatMove(item.move_san, item.move_uci)),
      detailRow("Recommended", formatMove(item.best_move_san, item.best_move_uci)),
      detailRow("Opponent reply", formatMove(item.best_reply_san, item.best_reply_uci)),
      detailRow("Opening line", item.opening_moves),
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
      renderMoveViewer(item, true);
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
      renderMoveViewer(item);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setControlsDisabled(disabled) {
  document.getElementById("analyzeBtn").disabled = disabled;
  document.getElementById("username").disabled = disabled;
  document.getElementById("maxGames").disabled = disabled;
  document.getElementById("plies").disabled = disabled;
  document.getElementById("depth").disabled = disabled;
  document.getElementById("timeMode").disabled = disabled;
  document.getElementById("timeControls").disabled = disabled;
}

function setProgress(percent, message, detail) {
  const panel = document.getElementById("progressPanel");
  const fill = document.getElementById("progressFill");
  const percentEl = document.getElementById("progressPercent");
  const text = document.getElementById("progressText");
  const detailEl = document.getElementById("progressDetail");
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

  panel.hidden = false;
  fill.style.width = `${safePercent}%`;
  percentEl.textContent = `${safePercent}%`;
  text.textContent = message || "Loading...";
  detailEl.textContent = detail || "";
}

async function pollAnalysisJob(jobId) {
  while (true) {
    const res = await fetch(`/lichess/jobs/${jobId}`);
    const job = await parseApiResponse(res);
    const current = job.current_game || 0;
    const total = job.total_games || 1;
    const percent = job.progress_percent ?? Math.round((current / total) * 100);
    const detail = [
      job.total_games ? `Game ${Math.min(current + (job.state === "analyzing" ? 1 : 0), job.total_games)} of ${job.total_games}` : null,
      job.game || null,
      job.time_control ? `Time control ${job.time_control}` : null,
    ].filter(Boolean).join(" - ");

    setProgress(percent, job.message || "Analyzing games", detail);

    if (job.state === "complete") {
      const skipped = job.result.skipped_games ? `, ${job.result.skipped_games} skipped` : "";
      setProgress(100, "Analysis complete", `${job.result.analyzed_games} games analyzed${skipped}`);
      return job.result;
    }

    if (job.state === "error") {
      throw new Error(job.error || "Analysis failed");
    }

    await sleep(700);
  }
}

async function analyze() {
  const username = document.getElementById("username").value.trim();
  const maxGames = document.getElementById("maxGames").value;
  const plies = document.getElementById("plies").value;
  const depth = document.getElementById("depth").value;
  const timeMode = document.getElementById("timeMode").value;
  const timeControls = document.getElementById("timeControls").value.trim();

  const status = document.getElementById("status");
  if (!username) {
    status.textContent = "Enter a Lichess username first.";
    return;
  }
  if (timeMode !== "all" && !timeControls) {
    status.textContent = "Enter at least one time control, like 3+0.";
    return;
  }

  status.textContent = "Starting analysis...";
  setProgress(0, "Loading...", "Preparing analysis");
  setControlsDisabled(true);
  document.getElementById("summary").replaceChildren();
  gameIndex = new Map();
  hideMoveViewer();
  renderEmpty(document.getElementById("recurringList"), "Analysis is running.");
  renderEmpty(document.getElementById("mistakeList"), "Analysis is running.");
  document.getElementById("details").textContent = "Analysis is running. The board will update when mistakes are found.";

  const params = new URLSearchParams({
    max: maxGames,
    plies,
    depth,
    timeMode,
    timeControls,
  });
  const url = `/lichess/${encodeURIComponent(username)}/opening_mistakes/jobs?${params.toString()}`;

  try {
    const res = await fetch(url, { method: "POST" });
    const started = await parseApiResponse(res);
    const data = await pollAnalysisJob(started.job_id);

    const all = [];
    gameIndex = new Map((data.games || []).map((game) => [Number(game.game_number), game]));
    for (const g of data.games || []) {
      for (const m of (g.mistakes || [])) {
        all.push({
          ...m,
          opening: g.opening || g.eco || "Unknown",
          opening_name: g.opening_name,
          opening_moves: g.opening_moves,
          opening_source: g.opening_source,
          opening_matched_plies: g.opening_matched_plies,
          eco: g.eco,
          white: g.white,
          black: g.black,
          opponent: g.opponent,
          user_color: g.user_color,
          result: g.result,
          date: g.date,
          site: g.site,
          event: g.event,
          time_control: g.time_control,
          time_control_raw: g.time_control_raw,
        });
      }
    }

    const skippedText = data.skipped_games ? ` (${plural(data.skipped_games, "game")} skipped by time filter)` : "";
    status.textContent = `Done. ${data.username} made ${plural(all.length, "opening mistake")} in ${plural(data.analyzed_games, "analyzed game")}${skippedText}.`;
    renderSummary(data, all);
    renderRecurring(document.getElementById("recurringList"), data.top_recurring_mistakes || []);
    renderMistakes(document.getElementById("mistakeList"), all);

    const first = all[0];
    if (first) {
      renderMoveViewer(first);
      renderDetails(first);
    } else if (data.analyzed_games === 0) {
      hideMoveViewer();
      document.getElementById("details").textContent = "No games matched this time-control filter.";
    } else {
      hideMoveViewer();
      document.getElementById("details").textContent = "No mistakes found for this player.";
    }
  } catch (e) {
    status.textContent = `Error: ${e.message}`;
    setProgress(100, "Analysis failed", e.message);
  } finally {
    setControlsDisabled(false);
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
  document.getElementById("moveSelect").addEventListener("change", (event) => {
    showHistoryPosition(event.target.value);
  });
  document.getElementById("moveSlider").addEventListener("input", (event) => {
    showHistoryPosition(event.target.value);
  });
  document.getElementById("prevMoveBtn").addEventListener("click", () => {
    if (currentReview) showHistoryPosition(currentReview.positionIndex - 1);
  });
  document.getElementById("nextMoveBtn").addEventListener("click", () => {
    if (currentReview) showHistoryPosition(currentReview.positionIndex + 1);
  });
});
