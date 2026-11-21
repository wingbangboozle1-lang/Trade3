/**
 * Dashboard client. No framework, no build step.
 * Talks to the local collector API with relative URLs so it works behind any proxy.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  data: null,
  topics: [],
  activeTopic: null,
  detailTicker: null,
  chartWindow: 'minutes',
  alertFilters: { basis: '', topic: '', direction: '' },
  // Default to confirmed dollar-denominated book depth: users asked to surface the
  // highest-dollar live opportunities. Contract counts stay separately labeled below.
  marketFilter: { topic: '', sort: 'liquidity' },
  es: null,
  seenAlertIds: new Set(),
  lastAlertSignature: '',
};

const fmtPrice = (p) => (p === null || p === undefined || Number.isNaN(Number(p)) ? '—' : `$${Number(p).toFixed(2)}`);
const fmtCents = (c) => (c === null || c === undefined ? '—' : `${c >= 0 ? '+' : '−'}$${Math.abs(c / 100).toFixed(2)}`);
const fmtNum = (n) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '—'
    : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtMoney = (n) =>
  n === null || n === undefined || Number.isNaN(Number(n))
    ? '—'
    : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const fmtDateTime = (ts) => (ts ? new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Build a link back to the official Kalshi record for a market.
 *  Uses the verified API-record URL (GET /markets/{ticker}); the demo web-UI pattern
 *  (demo.kalshi.co/markets/{ticker}) could not be verified from an official source and
 *  is flagged as unverified on the Flagged for Review page (F8/F9). */
const kalshiUrl = (ticker, env = 'demo') =>
  env === 'demo'
    ? `https://external-api.demo.kalshi.co/trade-api/v2/markets/${encodeURIComponent(ticker)}`
    : `https://external-api.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}`;

// ---------------------------------------------------------------- data fetch
async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function refresh() {
  try {
    const data = await fetchJson('/api/state');
    state.data = data;
    state.topics = data.topics ?? [];
    if (!state.activeTopic && state.topics.length) state.activeTopic = state.topics[0].id;
    renderAll();
  } catch (err) {
    setMode('offline', `Cannot reach the collector API (${err.message}). Start it with <code>npm start</code>.`);
  }
}

function connectStream() {
  if (state.es) state.es.close();
  const es = new EventSource('/api/stream');
  es.addEventListener('hello', (e) => {
    const d = JSON.parse(e.data);
    setMode(d.dataMode, null);
  });
  es.addEventListener('update', () => refresh());
  es.addEventListener('alert', (e) => {
    const alert = JSON.parse(e.data);
    state.seenAlertIds.add(alert.id);
    // Push straight into the chat so it scrolls without waiting for the next poll.
    if (state.data) {
      state.data.alerts = [alert, ...(state.data.alerts ?? [])].slice(0, 200);
      if (alert.score >= (state.data.highRoiMinScore ?? 45)) {
        state.data.modelAlerts = [alert, ...(state.data.modelAlerts ?? [])].slice(0, 120);
        state.data.alertCounts = {
          total: state.data.alerts.length,
          model: state.data.modelAlerts.length,
        };
      }
      renderFeeds();
      renderKpis();
    }
  });
  es.addEventListener('trade', () => refresh());
  es.onerror = () => {
    setMode('offline', 'Live stream disconnected. Reconnecting…');
    setTimeout(connectStream, 4000);
  };
  state.es = es;
}

// ---------------------------------------------------------------- rendering
function renderAll() {
  const d = state.data;
  if (!d) return;
  setMode(d.dataMode, null);
  $('#pollPill').textContent = d.status?.lastPollMs ? `poll ${d.status.lastPollMs}ms` : 'poll —';
  $('#clock').textContent = new Date().toLocaleTimeString();
  renderKpis();
  renderFeeds();
  renderTopics();
  renderAlertTable();
  renderMarketTable();
  renderPortfolio();
  renderResolutions();
  renderHelp();
  syncFilters();
}

function setMode(mode, message) {
  const pill = $('#modePill');
  const dot = $('#statusDot');
  const banner = $('#banner');
  const labels = {
    live: ['LIVE · demo API', 'ok'],
    starting: ['starting…', 'warn'],
    stale: ['STALE data', 'warn'],
    snapshot: ['SNAPSHOT (real, not live)', 'warn'],
    demo: ['SYNTHETIC demo data', 'bad'],
    offline: ['offline', 'bad'],
  };
  const [label, cls] = labels[mode] ?? [mode ?? 'unknown', 'warn'];
  pill.textContent = label;
  pill.className = `pill ${cls}`;
  dot.className = `dot ${cls}`;
  if (message) {
    banner.hidden = false;
    banner.innerHTML = message;
  } else if (mode === 'demo') {
    banner.hidden = false;
    banner.innerHTML =
      '<strong>Synthetic demo data — these are not Kalshi markets.</strong> The Kalshi API was unreachable from this host, ' +
      'so prices are generated locally to demonstrate the alert, chart and strategy pipeline. Every ticker is prefixed ' +
      '<code>DEMO-</code> and every title starts with <code>[DEMO]</code>. Set <code>DATA_MODE=live</code> and run on a ' +
      'network with normal egress for real values.';
  } else if (mode === 'snapshot') {
    banner.hidden = false;
    banner.innerHTML =
      '<strong>Snapshot of real values — not live.</strong> These markets and prices were captured from the Kalshi demo API ' +
      'at the timestamp below and are replayed, so prices do not move and no new swings can fire. ' +
      `<code>${esc(state.data?.status?.notes?.[0] ?? '')}</code>`;
  } else if (mode === 'stale') {
    banner.hidden = false;
    banner.innerHTML =
      '<strong>Data is stale.</strong> The last poll failed. The numbers below are the last values the collector saw, not current prices.';
  } else {
    banner.hidden = true;
  }
}

function renderKpis() {
  const d = state.data;
  if (!d) return;
  const tracked = d.topics.reduce((s, t) => s + t.marketCount, 0);
  const vol = d.topics.reduce((s, t) => s + (t.totalVolume24h ?? 0), 0);
  const biggest = [...(d.alerts ?? [])].sort((a, b) => b.moveDollars - a.moveDollars)[0];
  const p = d.portfolio?.simulated;
  $('#kpis').innerHTML = [
    kpi('Tracked markets', fmtNum(tracked), '5 topics only'),
    kpi('Swings ≥ $0.10', fmtNum(d.alertCounts?.total ?? 0), 'since collector start'),
    kpi('Model picks', fmtNum(d.alertCounts?.model ?? 0), `score ≥ ${d.highRoiMinScore ?? 45}`),
    kpi('24h contract volume', fmtNum(vol), 'contracts · Kalshi API field'),
    kpi('Biggest swing', biggest ? fmtPrice(biggest.moveDollars) : '—', biggest ? esc(truncate(biggest.title, 34)) : 'none yet'),
    kpi('Paper P&L', p ? fmtCents(p.realizedPnlCents) : '—', p ? `${p.tradeCount} closed · ${p.openPositionCount} open` : ''),
  ].join('');
}

const kpi = (label, value, sub) =>
  `<div class="kpi"><span>${esc(label)}</span><strong>${value}</strong><small>${sub}</small></div>`;

function renderFeeds() {
  const d = state.data;
  if (!d) return;
  $('#countAll').textContent = d.alertCounts?.total ?? 0;
  $('#countModel').textContent = d.alertCounts?.model ?? 0;
  renderFeed($('#feedAll'), d.alerts ?? [], false);
  renderFeed($('#feedModel'), d.modelAlerts ?? [], true);
}

function renderFeed(el, alerts, model) {
  if (!alerts.length) {
    el.innerHTML = `<div class="empty">${
      model
        ? 'No high-ROI swings yet. The model only posts when its score clears the threshold.'
        : 'No moves of $0.10 or more yet. The feed fills as soon as a contract swings.'
    }</div>`;
    return;
  }
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  el.innerHTML = alerts.slice(0, 120).map((a) => alertRow(a, model)).join('');
  if (nearBottom) el.scrollTop = 0; // newest first: keep the top pinned
}

function alertRow(a, model) {
  const dir = a.direction === 'up' ? 'up' : 'down';
  const arrow = dir === 'up' ? '▲' : '▼';
  const topic = state.topics.find((t) => t.id === a.topicId);
  const score = a.score ?? 0;
  return `<div class="alert ${dir}${model ? ' is-model' : ''}">
    <div class="alert-top">
      <span class="badge ${dir}">${arrow} ${fmtPrice(a.moveDollars)}</span>
      ${topic ? `<span class="topic-chip" style="--c:${topic.color}">${esc(topic.label)}</span>` : ''}
      <span class="alert-time">${fmtTime(a.ts)}</span>
      ${model ? `<span class="score" title="model score">${score}</span>` : ''}
    </div>
    <a class="alert-title" href="#" data-ticker="${esc(a.ticker)}" title="${esc(a.title)}">${esc(a.title)}</a>
    <div class="alert-meta">
      <span>${fmtPrice(a.fromPrice)} → ${fmtPrice(a.toPrice)}</span>
      <span class="basis" title="${a.basis === 'day' ? "Kalshi's previous_price_dollars (a day ago)" : 'previous poll'}">${a.basis}</span>
      ${a.liquidity?.dollars != null ? `<span>book ${fmtMoney(a.liquidity.dollars)}</span>` : ''}
      <a class="ext" href="${esc(a.kalshiUrl || kalshiUrl(a.ticker))}" target="_blank" rel="noopener" title="Open the official Kalshi API record for this market">API ↗</a>
    </div>
    ${model && a.roiFactors ? `<div class="factors">edge ${fmtPrice(a.roiFactors.netEdgePerContract)}/ct · fee ${fmtPrice(a.roiFactors.feePerContract)} (M×0.07×P×(1−P)) · spread cost ${fmtPrice(a.roiFactors.spreadCostPerContract)}</div>` : ''}
  </div>`;
}

function renderTopics() {
  const tabs = $('#topicTabs');
  tabs.innerHTML = state.topics
    .map(
      (t) =>
        `<button data-topic="${t.id}" class="${t.id === state.activeTopic ? 'on' : ''}" style="--c:${t.color}">${esc(t.label)} <span>${t.marketCount}</span></button>`,
    )
    .join('');
  $$('button', tabs).forEach((b) => (b.onclick = () => { state.activeTopic = b.dataset.topic; renderTopics(); }));

  const t = state.topics.find((x) => x.id === state.activeTopic);
  const body = $('#topicBody');
  if (!t) {
    body.innerHTML = '<div class="empty">No topic selected.</div>';
    return;
  }
  const rows = t.markets.slice(0, 25).map((m) => `
    <tr class="clickable" data-ticker="${esc(m.ticker)}">
      <td class="title-cell">${esc(truncate(m.title, 70))}<div class="tiny">${esc(m.eventTicker ?? '')}${m.kalshiCategory ? ` · Kalshi category: ${esc(m.kalshiCategory)}` : ''}</div></td>
      <td class="num">${fmtPrice(m.price)}</td>
      <td class="num">${fmtPrice(m.yesBid)} / ${fmtPrice(m.yesAsk)}</td>
      <td class="num">${fmtPrice(m.spread)}</td>
      <td class="num">${fmtNum(m.volume24h)}</td>
      <td class="num">${fmtNum(m.openInterest)}</td>
      <td class="num">${fmtMoney(m.liquidityDollars)}</td>
      <td class="num">${fmtDateTime(m.closeTime)}</td>
    </tr>`).join('');
  body.innerHTML = `
    <p class="topic-blurb">${esc(t.blurb)} <span class="hint">— ${t.marketCount} tracked, ${t.alerts} swing${t.alerts === 1 ? '' : 's'}, ${fmtMoney(t.totalVolume24h)} of 24h volume</span></p>
    <div class="tablewrap"><table class="data">
      <thead><tr><th>Market</th><th>Last</th><th>Yes bid/ask</th><th>Spread</th><th>24h vol</th><th>Open interest</th><th>Book liquidity</th><th>Closes</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="empty">No markets tracked in this topic yet.</td></tr>'}</tbody>
    </table></div>`;
  wireRowClicks(body);
}

function renderAlertTable() {
  const alerts = (state.data?.alerts ?? []).filter((a) => {
    const f = state.alertFilters;
    return (!f.basis || a.basis === f.basis) && (!f.topic || a.topicId === f.topic) && (!f.direction || a.direction === f.direction);
  });
  const rows = alerts
    .slice(0, 300)
    .map(
      (a) => `<tr>
      <td>${fmtDateTime(a.ts)}</td>
      <td>${esc(state.topics.find((t) => t.id === a.topicId)?.label ?? '—')}</td>
      <td class="title-cell"><a href="#" data-ticker="${esc(a.ticker)}">${esc(truncate(a.title, 60))}</a></td>
      <td class="num ${a.direction}">${a.direction === 'up' ? '▲' : '▼'} ${fmtPrice(a.moveDollars)}</td>
      <td class="num">${fmtPrice(a.fromPrice)}</td>
      <td class="num">${fmtPrice(a.toPrice)}</td>
      <td>${esc(a.basis)}</td>
      <td class="num">${a.score ?? '—'}</td>
      <td class="num">${fmtPrice(a.liquidity?.dollars != null ? a.liquidity.dollars : null).replace('$', '$')}</td>
      <td><a href="${esc(a.kalshiUrl || kalshiUrl(a.ticker))}" target="_blank" rel="noopener">source ↗</a></td>
    </tr>`,
    )
    .join('');
  $('#alertTable').innerHTML = `<thead><tr><th>Time</th><th>Topic</th><th>Market</th><th>Move</th><th>From</th><th>To</th><th>Basis</th><th>Score</th><th>Book $</th><th>Source</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="10" class="empty">No alerts match these filters yet.</td></tr>'}</tbody>`;
  wireRowClicks($('#alertTable'));
}

function renderMarketTable() {
  const f = state.marketFilter;
  const markets = state.topics
    .flatMap((t) => t.markets.map((m) => ({ ...m, topicLabel: t.label, topicColor: t.color })))
    .filter((m) => !f.topic || m.topicId === f.topic);
  const sorters = {
    volume: (a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0),
    oi: (a, b) => (b.openInterest ?? 0) - (a.openInterest ?? 0),
    liquidity: (a, b) => (b.liquidityDollars ?? 0) - (a.liquidityDollars ?? 0),
    move: (a, b) => Math.abs((b.price ?? 0) - (b.previousPrice ?? 0)) - Math.abs((a.price ?? 0) - (a.previousPrice ?? 0)),
    close: (a, b) => new Date(a.closeTime ?? 8640000000000000) - new Date(b.closeTime ?? 8640000000000000),
  };
  markets.sort(sorters[f.sort] ?? sorters.volume);
  const rows = markets.slice(0, 200).map((m) => {
    const move = m.price != null && m.previousPrice != null ? m.price - m.previousPrice : null;
    return `<tr class="clickable" data-ticker="${esc(m.ticker)}">
      <td><span class="topic-chip" style="--c:${m.topicColor}">${esc(m.topicLabel)}</span></td>
      <td class="title-cell">${esc(truncate(m.title, 64))}<div class="tiny">${esc(m.ticker)}</div></td>
      <td class="num">${fmtPrice(m.price)}</td>
      <td class="num ${move > 0 ? 'up' : move < 0 ? 'down' : ''}">${move === null ? '—' : `${move > 0 ? '+' : ''}${fmtPrice(move).replace('$', '$')}`}</td>
      <td class="num">${fmtPrice(m.yesBid)} / ${fmtPrice(m.yesAsk)}</td>
      <td class="num">${fmtNum(m.volume24h)}</td>
      <td class="num">${fmtNum(m.openInterest)}</td>
      <td class="num">${fmtMoney(m.liquidityDollars)}</td>
      <td class="num">${fmtDateTime(m.closeTime)}</td>
      <td><a href="${esc(m.kalshiUrl || kalshiUrl(m.ticker))}" target="_blank" rel="noopener">source ↗</a></td>
    </tr>`;
  }).join('');
  $('#marketTable').innerHTML = `<thead><tr><th>Topic</th><th>Market</th><th>Last</th><th>Δ day</th><th>Bid/Ask</th><th>24h contracts</th><th>OI contracts</th><th>Book liquidity ($)</th><th>Closes</th><th>Source</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="10" class="empty">No markets tracked yet.</td></tr>'}</tbody>`;
  $('#marketFootnote').innerHTML =
    'Δ day compares the current price with Kalshi\'s <code>previous_price_dollars</code> field ("Price for the last traded YES contract on this market a day ago"). ' +
    'Sorted by order-book liquidity ($) by default: displayed notional is price × contracts for the resting YES and NO bids returned by Kalshi. This is available bid depth, not traded dollar volume. Kalshi’s 24h volume field is contracts, so it is shown as a count rather than converted to dollars. ' +
    '<a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">Official order-book field definitions ↗</a>. Click a row for the chart and depth.';
  wireRowClicks($('#marketTable'));
}

function renderPortfolio() {
  const p = state.data?.portfolio;
  if (!p) return;
  const s = p.simulated;
  $('#portfolioKpis').innerHTML = [
    kpi('Simulated cash', fmtCents(s.cashCents), `started ${fmtCents(s.startingBalanceCents)}`),
    kpi('Realized P&L', fmtCents(s.realizedPnlCents), `${s.tradeCount} closed trades`),
    kpi('Open positions', fmtNum(s.openPositionCount), `${fmtCents(s.openCostCents)} at cost`),
    kpi('Win rate', p.analysis?.totals?.trades ? `${Math.round((p.analysis.totals.wins / p.analysis.totals.trades) * 100)}%` : '—', `${p.analysis?.totals?.wins ?? 0}W / ${p.analysis?.totals?.losses ?? 0}L`),
    kpi('Settled by market', fmtNum(p.analysis?.totals?.resolvedTrades ?? 0), 'held to resolution'),
  ].join('');

  const acct = p.kalshiDemoAccount;
  const acctEl = $('#kalshiAccount');
  if (!acct) {
    acctEl.innerHTML = '<div class="empty">Reading the Kalshi demo account…</div>';
  } else if (!acct.available) {
    acctEl.innerHTML = `<div class="empty">Not connected. <strong>${esc(acct.reason ?? '')}</strong><br/>
      To read the real demo balance and positions, set <code>KALSHI_API_KEY_ID</code> and <code>KALSHI_PRIVATE_KEY_PATH</code> and restart the collector.
      Keys are created in the Kalshi demo UI under Account &amp; security → API Keys (per docs.kalshi.com/getting_started/quick_start_authenticated_requests), and demo keys never work against production.
      <a href="https://docs.kalshi.com/getting_started/api_keys" target="_blank" rel="noopener">Official API key docs ↗</a></div>`;
  } else {
    const bal = acct.balance ?? {};
    const positions = acct.positions?.market_positions ?? [];
    const rows = positions.slice(0, 50).map((pos) => `<tr>
        <td class="title-cell">${esc(pos.ticker)}</td>
        <td class="num">${fmtNum(pos.position_fp)}</td>
        <td class="num">${fmtCents(Math.round(Number(pos.realized_pnl_dollars ?? 0) * 100))}</td>
        <td class="num">${fmtCents(Math.round(Number(pos.fees_paid_dollars ?? 0) * 100))}</td>
        <td class="num">${fmtMoney(Number(pos.total_traded_dollars ?? 0))}</td>
      </tr>`).join('');
    acctEl.innerHTML = `
      <div class="kpis inline">
        ${kpi('Demo balance', fmtMoney(Number(bal.balance ?? 0) / 100), 'cents → dollars')}
        ${kpi('Portfolio value', fmtMoney(Number(bal.portfolio_value ?? 0) / 100), 'cents → dollars')}
      </div>
      <p class="hint">Read ${esc(fmtDateTime(acct.readAt))} from <code>GET /portfolio/balance</code> and <code>GET /portfolio/positions</code>. Read-only; no orders are placed by this page.</p>
      <div class="tablewrap"><table class="data"><thead><tr><th>Ticker</th><th>Net contracts</th><th>Realized P&amp;L</th><th>Fees</th><th>Traded</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="empty">No demo positions.</td></tr>'}</tbody></table></div>`;
  }

  const strategies = p.analysis?.byStrategy ?? [];
  $('#strategyTable').innerHTML = `<thead><tr><th>Strategy</th><th>Trades</th><th>W</th><th>L</th><th>Win %</th><th>P&amp;L</th><th>ROI</th><th>Avg hold</th><th>Best</th><th>Worst</th></tr></thead>
    <tbody>${strategies.length ? strategies.map((r) => `<tr>
      <td><strong>${esc(r.label)}</strong><div class="tiny">${esc(p.strategies?.find((s) => s.id === r.strategy)?.thesis ?? '')}</div></td>
      <td class="num">${r.trades}</td>
      <td class="num up">${r.wins}</td>
      <td class="num down">${r.losses}</td>
      <td class="num">${r.winRatePct ?? '—'}%</td>
      <td class="num ${r.pnlCents >= 0 ? 'up' : 'down'}">${fmtCents(r.pnlCents)}</td>
      <td class="num ${r.roiPct >= 0 ? 'up' : 'down'}">${r.roiPct ?? '—'}%</td>
      <td class="num">${r.avgHoldMinutes == null ? '—' : `${r.avgHoldMinutes}m`}</td>
      <td class="num">${fmtCents(r.bestCents)}</td>
      <td class="num">${fmtCents(r.worstCents)}</td>
    </tr>`).join('') : '<tr><td colspan="10" class="empty">No closed simulated trades yet. Trades open when a high-ROI alert fires.</td></tr>'}</tbody>`;

  $('#openTable').innerHTML = `<thead><tr><th>Market</th><th>Strategy</th><th>Side</th><th>Entry</th><th>Now</th><th>Unrealized</th></tr></thead>
    <tbody>${p.openPositions.length ? p.openPositions.map((o) => `<tr class="clickable" data-ticker="${esc(o.ticker)}">
      <td class="title-cell">${esc(truncate(o.title ?? o.ticker, 44))}</td>
      <td>${esc(o.strategy)}</td>
      <td>${esc(o.outcome.toUpperCase())}</td>
      <td class="num">${fmtPrice(o.entryPrice)} × ${fmtNum(o.contracts)}</td>
      <td class="num">${fmtPrice(o.currentPrice)}</td>
      <td class="num ${o.unrealizedCents >= 0 ? 'up' : 'down'}">${fmtCents(o.unrealizedCents)}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">No open positions.</td></tr>'}</tbody>`;

  $('#closedTable').innerHTML = `<thead><tr><th>Market</th><th>Strategy</th><th>Side</th><th>Entry → Exit</th><th>P&amp;L</th><th>Reason</th></tr></thead>
    <tbody>${p.closedTrades.length ? p.closedTrades.slice(0, 50).map((t) => `<tr>
      <td class="title-cell">${esc(truncate(t.title ?? t.ticker, 38))}</td>
      <td>${esc(t.strategy)}</td>
      <td>${esc(t.outcome.toUpperCase())}</td>
      <td class="num">${fmtPrice(t.entryPrice)} → ${fmtPrice(t.exitPrice)}</td>
      <td class="num ${t.pnlCents >= 0 ? 'up' : 'down'}">${fmtCents(t.pnlCents)}</td>
      <td>${esc(t.closeReason)}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">No closed trades yet.</td></tr>'}</tbody>`;
  wireRowClicks($('#openTable'));
}

function renderResolutions() {
  const list = state.data?.resolutions ?? [];
  $('#resolutionTable').innerHTML = `<thead><tr><th>Resolved</th><th>Topic</th><th>Market</th><th>Result</th><th>Last price</th><th>Closes</th><th>Source</th></tr></thead>
    <tbody>${list.length ? list.map((r) => `<tr>
      <td>${fmtDateTime(r.closeTime)}</td>
      <td>${esc(state.topics.find((t) => t.id === r.topicId)?.label ?? '—')}</td>
      <td class="title-cell">${esc(truncate(r.title, 64))}<div class="tiny">${esc(r.ticker)}</div></td>
      <td><span class="result ${r.result}">${esc(r.result.toUpperCase())}</span></td>
      <td class="num">${fmtPrice(r.lastPrice)}</td>
      <td>${fmtDateTime(r.closeTime)}</td>
      <td><a href="${esc(r.kalshiUrl || kalshiUrl(r.ticker))}" target="_blank" rel="noopener">API ↗</a></td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">No resolutions captured yet. Settled markets in the five topics appear here as the collector sees them.</td></tr>'}</tbody>`;
}

function renderHelp() {
  const d = state.data;
  if (!d) return;
  $('#helpBody').innerHTML = `
    <h3>Data modes (read this first)</h3>
    <p>This dashboard can run in three modes, and it always says which one it is using in the pill at the top right:</p>
    <ul>
      <li><code>live</code> — reading the Kalshi demo API on every poll. This is the real thing.</li>
      <li><code>snapshot</code> — replaying a committed capture of <em>real</em> demo values. Truthful numbers, but frozen:
        prices cannot move, so no new swing alerts can fire.</li>
      <li><code>demo</code> — synthetic prices generated locally so the pipeline can be demonstrated when Kalshi's hosts
        are unreachable. Every ticker starts with <code>DEMO-</code>. These are <strong>not</strong> Kalshi markets and must
        never be read as market data.</li>
    </ul>
    <p>Set it with <code>DATA_MODE=live|snapshot|demo</code>. With <code>DATA_MODE=live</code> and
    <code>ALLOW_DEMO_FALLBACK=0</code> the app will report failure rather than quietly switch to synthetic data.</p>

    <h3>Data source</h3>
    <p>Every price comes from the official Kalshi <strong>demo</strong> Trade API at
    <code>${esc(d.environment.rest)}</code> (recommended demo base URL per
    <a href="${esc(d.environment.docs)}" target="_blank" rel="noopener">docs.kalshi.com/getting_started/demo_env</a>).
    The live WebSocket endpoint is <code>${esc(d.environment.ws)}</code>.
    Current data mode: <code>${esc(d.dataMode)}</code>. Last poll: ${esc(fmtDateTime(d.status?.lastPollAt))}.</p>

    <h3>Price basis</h3>
    <p>A market's displayed price is the order-book midpoint, derived exactly as the
    <a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">Orderbook Responses</a> page describes:
    best YES bid is the highest entry in <code>yes_dollars</code>, and best YES ask is <code>1.00 −</code> the highest entry in <code>no_dollars</code>.
    If a side is empty, the midpoint falls back to Kalshi's <code>last_price_dollars</code> ("price for the last traded YES contract").</p>

    <h3>Swing threshold</h3>
    <p>Alerts fire when the absolute price change is <strong>≥ $0.10</strong>. Comparisons are done in integer 1/10000-dollar units so a move of exactly $0.10 always fires.
    Two bases are tracked separately: <code>tick</code> (change since the previous poll) and <code>day</code> (change vs Kalshi's own
    <code>previous_price_dollars</code>, documented as the last traded price a day ago).</p>

    <h3>The two chats</h3>
    <p><strong>All swings</strong> shows every qualifying move. <strong>Model's high-ROI picks</strong> only shows swings whose score is ≥ ${d.highRoiMinScore}.
    The score is a transparent heuristic: a momentum × liquidity term minus an explicit cost per contract (half-spread plus Kalshi's published fee,
    <code>M × 0.07 × C × P × (1 − P)</code>, from the
    <a href="https://kalshi.com/docs/kalshi-fee-schedule.pdf" target="_blank" rel="noopener">official fee schedule</a>). Each pick lists its own edge, fee and spread-cost inputs, so nothing is hidden behind the number.</p>

    <h3>Simulated trading</h3>
    <p>When a high-ROI alert fires, the engine opens a paper position using one of four documented strategies
    (${(d.portfolio?.strategies ?? []).map((s) => esc(s.label)).join(', ')}), sized at 5% of paper cash.
    Exits are take-profit, stop-loss, market close, or official resolution. P&amp;L assumes a winning contract pays $1.00, per
    <a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement</a>.
    This is a simulator: it cannot and does not place real orders.</p>

    <h3>What is not verified</h3>
    <p>The fee formula is quoted from Kalshi's official fee schedule (effective 2026-07-07). What is <em>not</em> verified is each individual
    series' multiplier, which the pages checked do not enumerate for every series; the app uses the <code>fee_multiplier</code> the series object returns.
    Anything the API does not return is shown as an em dash rather than guessed.
    See the <a href="/site/flagged.html">Flagged for Review</a> page on the published site for the full list.</p>

    <h3>Official references</h3>
    <ul class="refs">
      <li><a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Test In The Demo Environment</a></li>
      <li><a href="https://docs.kalshi.com/getting_started/api_environments" target="_blank" rel="noopener">API Environments and Endpoints</a></li>
      <li><a href="https://docs.kalshi.com/getting_started/api_keys" target="_blank" rel="noopener">API Keys and request signing</a></li>
      <li><a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">Orderbook Responses</a></li>
      <li><a href="https://docs.kalshi.com/api-reference/market/get-markets" target="_blank" rel="noopener">Get Markets</a></li>
      <li><a href="https://docs.kalshi.com/api-reference/market/get-trades" target="_blank" rel="noopener">Get Trades</a></li>
      <li><a href="https://docs.kalshi.com/api-reference/market/get-market-candlesticks" target="_blank" rel="noopener">Get Market Candlesticks</a></li>
      <li><a href="https://docs.kalshi.com/api-reference/orders/create-order-v2" target="_blank" rel="noopener">Create Order (V2)</a></li>
      <li><a href="https://docs.kalshi.com/getting_started/market_settlement" target="_blank" rel="noopener">Market Settlement</a></li>
      <li><a href="https://docs.kalshi.com/getting_started/rate_limits" target="_blank" rel="noopener">Rate Limits and Tiers</a></li>
    </ul>`;
}

function syncFilters() {
  const topicOpts = state.topics.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('');
  for (const sel of ['#alertTopic', '#marketTopic']) {
    const el = $(sel);
    if (el && el.options.length === 1) el.innerHTML += topicOpts;
  }
}

// ---------------------------------------------------------------- detail view
async function openDetail(ticker) {
  state.detailTicker = ticker;
  const detail = $('#detail');
  detail.hidden = false;
  document.body.classList.add('drawer-open');
  const market = state.topics.flatMap((t) => t.markets).find((m) => m.ticker === ticker);
  if (market) {
    $('#detailTitle').textContent = market.title;
    $('#detailSub').innerHTML = `${esc(market.ticker)} · ${esc(state.topics.find((t) => t.id === market.topicId)?.label ?? '')} · closes ${esc(fmtDateTime(market.closeTime))}`;
    $('#dPrice').textContent = fmtPrice(market.price);
    $('#dBidAsk').textContent = `${fmtPrice(market.yesBid)} / ${fmtPrice(market.yesAsk)}`;
    $('#dSpread').textContent = fmtPrice(market.spread);
    $('#dVol').textContent = fmtNum(market.volume24h);
    $('#dOI').textContent = fmtNum(market.openInterest);
    $('#dLiq').textContent = `${fmtMoney(market.liquidityDollars)} · ${fmtNum(market.liquidityContracts)} ct`;
    $('#dLink').href = market.kalshiUrl || kalshiUrl(ticker);
    renderBook(market.book);
  }
  await loadChart();
  const alerts = (state.data?.alerts ?? []).filter((a) => a.ticker === ticker);
  $('#dAlerts').innerHTML = alerts.length
    ? alerts.map((a) => alertRow(a, false)).join('')
    : '<div class="empty">No swing alerts on this market yet.</div>';
}

function renderBook(book) {
  if (!book || (!book.yes?.length && !book.no?.length)) {
    $('#dBook').innerHTML = '<div class="empty">No resting orders on either side right now.</div>';
    return;
  }
  const rows = (levels, side) =>
    levels
      .slice()
      .reverse()
      .map((l) => `<div class="book-row ${side}"><span>${fmtPrice(l.price)}</span><span>${fmtNum(l.count)} ct</span><span>${fmtMoney(l.price * l.count)}</span></div>`)
      .join('');
  $('#dBook').innerHTML = `
    <div class="book-col"><h4>YES bids</h4>${rows(book.yes ?? [], 'yes') || '<div class="empty">none</div>'}</div>
    <div class="book-col"><h4>NO bids <span class="hint">(→ YES ask = 1 − price)</span></h4>${rows(book.no ?? [], 'no') || '<div class="empty">none</div>'}</div>`;
}

async function loadChart() {
  if (!state.detailTicker) return;
  try {
    const data = await fetchJson(`/api/chart/${encodeURIComponent(state.detailTicker)}?window=${state.chartWindow}`);
    $('#chartLabel').textContent = `${data.label} · ${data.series.length} point${data.series.length === 1 ? '' : 's'} · ${data.dataMode}`;
    $('#dCandles').href = data.officialCandlesUrl;
    drawChart($('#chart'), data);
  } catch (err) {
    $('#chartLabel').textContent = `chart unavailable: ${err.message}`;
  }
}

function drawChart(canvas, data) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 640;
  const cssH = 240;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { l: 46, r: 12, t: 14, b: 26 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;

  ctx.strokeStyle = '#1e2a3a';
  ctx.fillStyle = '#8b9bb4';
  ctx.font = '11px ui-monospace, monospace';
  ctx.lineWidth = 1;

  // Y axis: contract price. Prices are bounded 0..1 but we zoom to the data.
  let min = 0;
  let max = 1;
  const prices = data.series.map((p) => p.p).filter((p) => Number.isFinite(p));
  if (prices.length) {
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const padY = Math.max(0.02, (hi - lo) * 0.25);
    min = Math.max(0, lo - padY);
    max = Math.min(1, hi + padY);
  }
  const xOf = (t, t0, t1) => pad.l + (t1 === t0 ? w / 2 : ((t - t0) / (t1 - t0)) * w);
  const yOf = (p) => pad.t + h - ((p - min) / (max - min || 1)) * h;

  for (let i = 0; i <= 4; i += 1) {
    const p = min + ((max - min) * i) / 4;
    const y = yOf(p);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
    ctx.fillText(`$${p.toFixed(2)}`, 4, y + 4);
  }

  if (!data.series.length) {
    ctx.fillStyle = '#8b9bb4';
    ctx.fillText('Collecting samples… this chart fills as polls arrive.', pad.l + 8, pad.t + h / 2);
    return;
  }

  const t0 = data.series[0].t;
  const t1 = data.series[data.series.length - 1].t;
  // X axis ticks
  ctx.fillStyle = '#8b9bb4';
  for (let i = 0; i <= 4; i += 1) {
    const t = t0 + ((t1 - t0) * i) / 4;
    const x = xOf(t, t0, t1);
    const label = state.chartWindow === 'hours'
      ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    ctx.fillText(label, Math.min(x, cssW - 46), cssH - 8);
  }

  // $0.10 threshold guides around the current price are shown as dashed lines.
  const current = data.current;
  if (Number.isFinite(current)) {
    for (const bound of [current - 0.1, current + 0.1]) {
      if (bound < min || bound > max) continue;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#f59e0b55';
      ctx.beginPath();
      ctx.moveTo(pad.l, yOf(bound));
      ctx.lineTo(pad.l + w, yOf(bound));
      ctx.stroke();
      ctx.restore();
    }
  }

  // Area + line
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  grad.addColorStop(0, 'rgba(34,197,94,0.35)');
  grad.addColorStop(1, 'rgba(34,197,94,0.02)');
  ctx.beginPath();
  data.series.forEach((p, i) => {
    const x = xOf(p.t, t0, t1);
    const y = yOf(p.p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  const lastX = xOf(data.series[data.series.length - 1].t, t0, t1);
  ctx.lineTo(lastX, pad.t + h);
  ctx.lineTo(pad.l, pad.t + h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  data.series.forEach((p, i) => {
    const x = xOf(p.t, t0, t1);
    const y = yOf(p.p);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.stroke();

  const last = data.series[data.series.length - 1];
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(xOf(last.t, t0, t1), yOf(last.p), 3.5, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------- wiring
function wireRowClicks(root) {
  $$('[data-ticker]', root).forEach((el) => {
    if (el.tagName === 'A' && el.getAttribute('href') !== '#') return;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openDetail(el.dataset.ticker);
    });
  });
}

function truncate(s, n) {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function init() {
  $$('.tabs button').forEach((btn) => {
    btn.onclick = () => {
      $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      $$('.view').forEach((v) => (v.hidden = v.id !== `view-${btn.dataset.view}`));
    };
  });

  $('#alertBasis').onchange = (e) => { state.alertFilters.basis = e.target.value; renderAlertTable(); };
  $('#alertTopic').onchange = (e) => { state.alertFilters.topic = e.target.value; renderAlertTable(); };
  $('#alertDir').onchange = (e) => { state.alertFilters.direction = e.target.value; renderAlertTable(); };
  $('#marketTopic').onchange = (e) => { state.marketFilter.topic = e.target.value; renderMarketTable(); };
  $('#marketSort').onchange = (e) => { state.marketFilter.sort = e.target.value; renderMarketTable(); };

  $('#detailClose').onclick = () => {
    $('#detail').hidden = true;
    document.body.classList.remove('drawer-open');
    state.detailTicker = null;
  };
  $$('.seg button').forEach((b) => {
    b.onclick = () => {
      $$('.seg button').forEach((x) => x.classList.toggle('on', x === b));
      state.chartWindow = b.dataset.window;
      loadChart();
    };
  });
  window.addEventListener('resize', () => {
    if (state.detailTicker) loadChart();
  });

  refresh();
  connectStream();
  setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString(); }, 1000);
  setInterval(() => { if (!state.es || state.es.readyState > 1) refresh(); }, 20000);
}

init();
