// Dashboard client. Zero dependencies, hand-rolled canvas charts.
//
// Design rules this file follows:
//  * Never invent a number. If the API has no value, render an em dash.
//  * Every externally-sourced figure links to its source page.
//  * A simulated feed is labelled as simulated in the header AND on every panel that
//    shows prices, so a screenshot cannot be mistaken for real market data.

/* ------------------------------------------------------------------ helpers */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const fmt2 = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const dash = (v) => (v === null || v === undefined || v === '' ? '—' : v);

function moneyFromTicks(ticks) {
  if (ticks === null || ticks === undefined) return '—';
  return `$${fmt2(ticks / 1e6)}`;
}

function priceFromTicks(ticks) {
  if (ticks === null || ticks === undefined) return '—';
  return (ticks / 1e6).toFixed(2);
}

function cents(ticks) {
  if (ticks === null || ticks === undefined) return '—';
  const c = ticks / 10_000;
  return `${c > 0 ? '+' : ''}${c.toFixed(1)}¢`;
}

function ago(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function timeLeft(sec, at = Date.now()) {
  if (!sec) return '—';
  const d = sec * 1000 - at;
  if (d <= 0) return 'closed';
  const m = Math.round(d / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* -------------------------------------------------------------------- state */
const state = {
  ws: null,
  wsOk: false,
  status: null,
  topics: [],
  alerts: [], // newest last
  modelAlerts: [],
  resolutions: [],
  chartMarket: null,
  chartRange: '5m',
  chatPaused: { all: false, model: false },
  activeTab: 'live',
  activeTopic: null,
  bookTicker: null,
  events: [],
  searchRows: []
};

const RANGES = ['1s', '10s', '1m', '5m', '1h', '6h', '1d'];
const RANGE_MS = { '1s': 1e3, '10s': 1e4, '1m': 6e4, '5m': 3e5, '1h': 36e5, '6h': 216e5, '1d': 864e5 };

/* ----------------------------------------------------------------------- ws */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;

  ws.onopen = () => {
    state.wsOk = true;
    updateHealthDot();
  };
  ws.onclose = () => {
    state.wsOk = false;
    updateHealthDot();
    setTimeout(connect, 2500);
  };
  ws.onerror = () => {
    state.wsOk = false;
    updateHealthDot();
  };
  ws.onmessage = (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.type === 'hello') {
      state.status = m.status;
      (m.alerts || []).forEach(addAlert);
      (m.resolutions || []).forEach(addResolution);
      renderStatus();
    } else if (m.type === 'alert') addAlert(m.alert);
    else if (m.type === 'resolution') addResolution(m.resolution);
    else if (m.type === 'paperTrade') {
      flashPaper();
      schedulePortfolioRefresh();
    } else if (m.type === 'feed') {
      state.status = { ...(state.status || {}), ws: m.feed };
      renderStatus();
    } else if (m.type === 'discovery') {
      state.status = { ...(state.status || {}), discovery: m.discovery };
      renderStatus();
    } else if (m.type === 'mode') {
      state.status = { ...(state.status || {}), mode: m.mode, modeReason: m.reason };
      renderStatus();
    }
  };
}

function updateHealthDot() {
  const dot = $('#feedDot');
  if (!dot) return;
  dot.className = `dot ${state.wsOk ? 'ok' : 'bad'}`;
  $('#feedLabel').textContent = state.wsOk ? 'browser feed ok' : 'browser feed down';
}

/* ------------------------------------------------------------------- alerts */
function addAlert(a) {
  state.alerts.push(a);
  if (state.alerts.length > 400) state.alerts.splice(0, state.alerts.length - 400);
  appendChatCard('#chatAll', a, false, 'all');
  if (a.highRoi) {
    state.modelAlerts.push(a);
    if (state.modelAlerts.length > 200) state.modelAlerts.splice(0, state.modelAlerts.length - 200);
    appendChatCard('#chatModel', a, true, 'model');
    const c = $('#chat2Count');
    if (c) c.textContent = state.modelAlerts.length;
  }
  const c1 = $('#chat1Count');
  if (c1) c1.textContent = state.alerts.length;
  const m = $('#mAlerts');
  if (m) m.textContent = state.alerts.length;
}

function chipForTopic(id) {
  return id ? `<span class="chip ${esc(id)}">${esc(id)}</span>` : '<span class="chip">unclassified</span>';
}

function chatCardHTML(a, showWhy) {
  const dir = a.direction === 'up' ? 'up' : 'down';
  const arrow = a.direction === 'up' ? '▲' : '▼';
  const causes = (a.causes || [])
    .map(
      (c) =>
        `<a href="${esc(c.url)}" target="_blank" rel="noopener" title="candidate cause, not confirmed: ${esc(c.kind)}">${esc(
          c.title.length > 42 ? `${c.title.slice(0, 42)}…` : c.title
        )}</a>`
    )
    .join('');
  const s = a.score;
  let why = '';
  if (showWhy && s) {
    const maker = s.maker;
    const taker = s.taker;
    const bits = [];
    if (maker) bits.push(`maker ${maker.side.toUpperCase()} @ ${priceFromTicks(maker.bidTicks)} → EV ${cents(maker.evTicks)}/ct (half-spread ${cents(maker.halfSpreadTicks)}, maker fee ${cents(maker.makerFeeTicks)})`);
    if (taker) bits.push(`taker ${taker.side.toUpperCase()} @ ${priceFromTicks(taker.askTicks)} → EV ${cents(taker.evTicks)}/ct`);
    if (s.coherence) bits.push(`coherence ${s.coherence.side.toUpperCase()} · sum YES ${priceFromTicks(s.coherence.sumYesTicks)} → ${cents(s.coherence.perLegEdgeTicks)}/leg`);
    if (s.reasons?.length) bits.push(`<span class="warn">${esc(s.reasons.slice(0, 2).join('; '))}</span>`);
    why = `<div class="why">${bits.join(' · ')}</div>`;
  }
  const scoreChip = s
    ? `<span class="chip ${s.promote ? 'ok' : 'no'}">EV ${cents(s.bestEvTicks)}/ct${s.returnBps != null ? ` · ${s.returnBps}bps` : ''}</span>`
    : '';
  return `<div class="msg ${dir} ${a.highRoi ? 'highroi' : ''}">
    <div class="line1">
      <span class="delta ${dir}">${arrow} ${esc(a.delta)}</span>
      <span class="title">${esc(a.marketTitle || a.eventTitle || a.ticker)}</span>
      ${chipForTopic(a.topic)}
      ${scoreChip}
    </div>
    <div class="meta">${esc(a.ticker)} · ${priceFromTicks(a.fromTicks ? null : null) === '—' ? '' : ''}${esc(a.from)} → ${esc(a.to)} · ${esc(a.source)} · ${new Date(a.toTs).toLocaleTimeString('en-US', { hour12: false })}${a.kind === 'drift' ? ' · drift' : ''}</div>
    ${why}
    ${causes ? `<div class="causes">${causes}</div>` : ''}
  </div>`;
}

function appendChatCard(sel, a, showWhy, which) {
  const el = $(sel);
  if (!el) return;
  const paused = state.chatPaused[which];
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  const div = document.createElement('div');
  div.innerHTML = chatCardHTML(a, showWhy);
  el.appendChild(div.firstElementChild);
  while (el.children.length > 200) el.removeChild(el.firstChild);
  if (!paused && nearBottom) el.scrollTop = el.scrollHeight;
  el.classList.toggle('paused', paused);
}

/* --------------------------------------------------------------- resolutions */
function addResolution(r) {
  if (state.resolutions.find((x) => x.id === r.id)) return;
  state.resolutions.unshift(r);
  renderResolutions();
}

function renderResolutions() {
  const body = $('#resBody');
  if (!body) return;
  if (!state.resolutions.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty"><b>No resolutions observed yet.</b>A market appears here when the feed reports it as determined or settled.</td></tr>`;
  } else {
    body.innerHTML = state.resolutions
      .slice(0, 300)
      .map(
        (r) => `<tr>
        <td class="mono dim">${new Date(r.observedAt || Date.now()).toLocaleString('en-US', { hour12: false })}</td>
        <td class="ellipsis" title="${esc(r.eventTitle)}">${esc(r.eventTitle || r.eventTicker)}</td>
        <td class="ellipsis">${esc(r.marketTitle || r.ticker)}</td>
        <td>${chipForTopic(r.topic)}</td>
        <td><span class="chip ${r.result === 'yes' ? 'ok' : 'no'}">${esc((r.result || '').toUpperCase())}</span></td>
        <td class="num">${r.settlementValueTicks !== null ? moneyFromTicks(r.settlementValueTicks) : '—'}</td>
        <td class="mono dim">${r.determinedTs ? new Date(r.determinedTs * 1000).toLocaleString('en-US', { hour12: false }) : '—'}</td>
        <td class="mono dim" title="${esc(r.source)}">lifecycle</td>
      </tr>`
      )
      .join('');
  }
  const c = $('#resCount');
  if (c) c.textContent = state.resolutions.length;
}

/* -------------------------------------------------------------------- status */
function renderStatus() {
  const s = state.status;
  if (!s) return;
  const prov = $('#prov');
  const p = s.provenance || (s.mode === 'live' ? { kind: 'live', label: 'LIVE' } : { kind: 'simulated', label: 'SIMULATED' });
  if (prov) {
    prov.textContent = p.label || p.kind;
    prov.className = `provenance ${p.kind}`;
    prov.title = p.detail || '';
  }
  $('#envLabel').textContent = s.environment ? `${s.environment} · ${s.restBase || ''}` : '';
  document.body.dataset.provenance = p.kind;

  const banner = $('#modeBanner');
  if (banner) {
    if (p.kind === 'simulated') {
      banner.innerHTML = `<div class="banner"><b>Simulated feed.</b> ${esc(
        s.modeReason || 'No Kalshi connection is available, so this dashboard is running a local simulator that mimics Kalshi message shapes.'
      )} None of the prices below are Kalshi prices. To go live, set <span class="mono">KALSHI_KEY_ID</span> and <span class="mono">KALSHI_PRIVATE_KEY_PATH</span> and restart. Read <a href="/docs/model.html">how the model works</a>.</div>`;
    } else if (p.kind === 'live') {
      banner.innerHTML = `<div class="banner info">Live against the Kalshi <b>demo</b> environment. Kalshi warns that demo market prices and behaviour may not reflect real markets. <a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Kalshi documentation</a></div>`;
    } else {
      banner.innerHTML = `<div class="banner bad">${esc(s.modeReason || 'No data source connected.')}</div>`;
    }
  }

  $('#mMarkets').textContent = s.discovery?.markets ?? 0;
  const paper = s.paper;
  $('#mPaper').textContent = paper ? moneyFromTicks(paper.equityTicks) : '—';
  $('#mLive').textContent = s.live?.connected ? 'connected' : s.live?.credentialsPresent ? 'error' : 'no key';
  $('#mClock').textContent = new Date().toLocaleTimeString('en-US', { hour12: false });

  const wsChip = $('#wsChip');
  if (wsChip) {
    const ws = s.ws || {};
    const kind = s.mode === 'mock' ? 'simulated' : ws.connected ? 'ok' : 'no';
    wsChip.textContent = s.mode === 'mock' ? `simulator · ${ws.ticks ?? 0} ticks` : ws.connected ? 'ws connected' : 'ws down';
    wsChip.className = `chip ${kind}`;
  }

  const hc = $('#healthCards');
  if (hc) {
    const d = s.discovery || {};
    const stats = s.alertStats || {};
    const tokens = s.rest ? s.rest.calls : null;
    hc.innerHTML = [
      ['Feed', s.mode === 'mock' ? 'simulated' : s.mode, s.modeReason || ''],
      ['Markets tracked', String(d.markets ?? 0), `${d.events ?? 0} events · ${d.unclassified ?? 0} unclassified`],
      ['Observations', String(stats.observations ?? 0), `${stats.marketsTracked ?? 0} markets in the alert window`],
      ['Swings flagged', String(stats.alerts ?? 0), `threshold $${((stats.thresholdTicks ?? 0) / 1e6).toFixed(2)} · cooldown ${Math.round((stats.cooldownMs ?? 0) / 1000)}s`],
      ['REST calls', tokens === null ? '—' : String(tokens), s.rest ? `${s.rest.errors ?? 0} errors · ${s.rest.rateLimited ?? 0} rate-limited` : 'not in use'],
      ['Demo account', s.live?.connected ? 'connected' : 'not connected', s.live?.credentialsPresent ? 'key present' : 'no API key — market data only']
    ]
      .map(
        ([k, v, sub]) => `<div class="card"><div class="k">${esc(k)}</div><div class="v" style="font-size:15px">${esc(v)}</div><div class="s">${esc(sub)}</div></div>`
      )
      .join('');
  }

  const kw = $('#keyWarn');
  if (kw) {
    if (s.keyWarning) kw.innerHTML = `<div class="banner bad">Private key problem: ${esc(s.keyWarning)}</div>`;
    else if (!s.live?.credentialsPresent) kw.innerHTML = `<div class="banner">No API key configured, so orders and the demo account panel are disabled. Keys are not needed for market data. <a href="https://docs.kalshi.com/getting_started/api_keys" target="_blank" rel="noopener">How to create a key</a></div>`;
    else kw.innerHTML = '';
  }
}

/* --------------------------------------------------------------------- tabs */
const TABS = [
  ['live', 'Live'],
  ['topics', 'Topics'],
  ['portfolio', 'Portfolio'],
  ['resolutions', 'Resolutions'],
  ['search', 'Search']
];

function buildTabs() {
  const nav = $('#tabs');
  const mk = () => {
    nav.innerHTML =
      TABS.map(([id, label]) => `<button class="tab ${state.activeTab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('') +
      `<span style="margin-left:auto"></span>` +
      state.topics.map((t) => `<button class="tab ${state.activeTab === `topic:${t.id}` ? 'active' : ''}" data-topic="${t.id}">${esc(t.name)}</button>`).join('');
    nav.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
    nav.querySelectorAll('[data-topic]').forEach(
      (b) => (b.onclick = () => {
        state.activeTopic = b.dataset.topic;
        showTab('topics');
      })
    );
  };
  mk();
}

function showTab(id) {
  state.activeTab = id;
  ['live', 'topics', 'portfolio', 'resolutions', 'search'].forEach((v) => {
    const el = $(`#view-${v}`);
    if (el) el.hidden = v !== id;
  });
  $$('.tab[data-tab], .tab[data-topic]').forEach((b) => {
    const isTopic = b.dataset.topic && id === 'topics';
    b.classList.toggle('active', b.dataset.tab === id || (isTopic && b.dataset.topic === state.activeTopic));
  });
  if (id === 'topics') loadTopic();
  if (id === 'portfolio') loadPortfolio();
  if (id === 'resolutions') renderResolutions();
  if (id === 'search') renderSearch();
}

/* ------------------------------------------------------------------- events */
async function loadEvents() {
  try {
    const r = await fetch('/api/events?limit=40');
    const d = await r.json();
    state.events = d.events || [];
    renderEvents();
  } catch {
    /* keep last render */
  }
}

function renderEvents() {
  const body = $('#evBody');
  if (!body) return;
  const q = ($('#evSearch')?.value || '').toLowerCase().trim();
  const rows = state.events.filter(
    (e) => !q || `${e.eventTicker} ${e.eventTitle} ${e.topic}`.toLowerCase().includes(q)
  );
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty"><b>No live events in the five topics.</b>${q ? 'Nothing matches that filter.' : 'Discovery returned no matching markets yet.'}</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((e, i) => {
      const status = e.resolved ? `<span class="chip ${e.resolved === 'yes' ? 'ok' : 'no'}">${e.resolved.toUpperCase()}</span>` : '<span class="chip no">open</span>';
      const basis = e.dollarVolumeBasis?.includes('derived') ? ' <span class="chip warn" title="computed as volume x price, not a reported field">derived</span>' : '';
      return `<tr data-event="${esc(e.eventTicker)}">
      <td class="num dim">${i + 1}</td>
      <td><div class="ellipsis" title="${esc(e.eventTitle)}">${esc(e.eventTitle)}</div><span class="ticker">${esc(e.eventTicker)}</span></td>
      <td>${chipForTopic(e.topic)}</td>
      <td class="num">${e.dollarVolume === null ? '—' : moneyFromTicks(Math.round(e.dollarVolume * 1e6))}${basis}</td>
      <td class="num">${e.markets.length}</td>
      <td class="num">${e.openInterest === null ? '—' : Math.round(e.openInterest).toLocaleString('en-US')}</td>
      <td class="num">${timeLeft(e.closesAt)}</td>
      <td>${status}</td>
    </tr>`;
    })
    .join('');
}

/* -------------------------------------------------------------------- topic */
async function loadTopic() {
  const id = state.activeTopic || state.topics[0]?.id;
  if (!id) return;
  state.activeTopic = id;
  const chip = $('#topicChip');
  if (chip) {
    chip.textContent = id;
    chip.className = `chip ${id}`;
  }
  try {
    const r = await fetch(`/api/topic/${id}`);
    const d = await r.json();
    $('#topicTitle').textContent = d.topic?.name || id;
    const body = $('#topicBody');
    if (!d.events?.length) {
      body.innerHTML = `<tr><td colspan="9" class="empty"><b>No ${esc(d.topic?.name || id)} markets found.</b>Discovery depends on live series metadata; nothing is invented to fill this page.</td></tr>`;
      return;
    }
    body.innerHTML = d.events
      .map((ev) => {
        const head = `<tr><td colspan="9" style="background:#131c2a"><b>${esc(ev.title)}</b> <span class="ticker">${esc(ev.eventTicker)}</span> · closes ${timeLeft(ev.closesAt)}${ev.resolved ? ` · <span class="chip ${ev.resolved === 'yes' ? 'ok' : 'no'}">${ev.resolved.toUpperCase()}</span>` : ''}</td></tr>`;
        const rows = ev.rows
          .map(
            (m) => `<tr class="mrow" data-ticker="${esc(m.ticker)}">
          <td class="ellipsis" title="${esc(m.market)}">${esc(m.market)}</td>
          <td class="ticker">${esc(m.ticker)}</td>
          <td class="num">${m.yesBid}</td><td class="num">${m.yesAsk}</td>
          <td class="num">${m.last}</td><td class="num">${m.spread}</td>
          <td class="num">${m.volume ?? '—'}</td>
          <td class="num">${timeLeft(m.closesSec)}</td>
          <td>${m.result ? `<span class="chip ${m.result === 'yes' ? 'ok' : 'no'}">${m.result.toUpperCase()}</span>` : '<span class="chip no">—</span>'}</td>
        </tr>`
          )
          .join('');
        return head + rows;
      })
      .join('');
    $$('#topicBody .mrow').forEach((tr) => (tr.onclick = () => loadBook(tr.dataset.ticker)));
    if (d.events[0]?.rows[0]) loadBook(d.events[0].rows[0].ticker);
  } catch (err) {
    $('#topicBody').innerHTML = `<tr><td colspan="9" class="empty">could not load: ${esc(err.message)}</td></tr>`;
  }
}

async function loadBook(ticker) {
  state.bookTicker = ticker;
  $('#bookTicker').textContent = ticker;
  try {
    const r = await fetch(`/api/market/${encodeURIComponent(ticker)}`);
    const d = await r.json();
    const m = d.market;
    if (!m?.book) {
      $('#bookBody').innerHTML = `<div class="empty"><b>No book snapshot yet.</b>Depth arrives on the next REST/poll cycle. The API returns bids only; asks are implied as 1 − opposite bid.</div>`;
      return;
    }
    const s = m.book.summary || {};
    const fmtLevels = (levels, cls) =>
      [...(levels || [])]
        .reverse()
        .map((l) => `<div class="row ${cls}"><span>${priceFromTicks(l.ticks)}</span><span>${Math.round(l.count)}</span></div>`)
        .join('');
    $('#bookBody').innerHTML = `
      <div class="cards" style="margin-bottom:10px">
        <div class="card"><div class="k">Best YES bid</div><div class="v">${priceFromTicks(s.bestYesBid)}</div><div class="s">${s.yesContractsAtTouch ?? 0} at touch</div></div>
        <div class="card"><div class="k">Best YES ask</div><div class="v">${priceFromTicks(s.bestYesAsk)}</div><div class="s">implied 1 − NO bid</div></div>
        <div class="card"><div class="k">Spread</div><div class="v">${s.spreadTicks != null ? (s.spreadTicks / 10_000).toFixed(1) + '¢' : '—'}</div><div class="s">bid→ask</div></div>
        <div class="card"><div class="k">Depth (contracts)</div><div class="v">${s.yesContracts ?? '—'} / ${s.noContracts ?? '—'}</div><div class="s">YES / NO side</div></div>
      </div>
      <div class="ladder">
        <div class="side"><h4>YES bids</h4>${fmtLevels(m.book.yesLevels, 'bid')}</div>
        <div class="side"><h4>NO bids (⇒ YES asks)</h4>${fmtLevels(m.book.noLevels, 'ask')}</div>
      </div>
      <div class="footnote" style="border:0;padding:10px 0 0">Sizes are aggregated per price level; Kalshi does not return per-order counts. <a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">source</a></div>`;
    state.chartMarket = ticker;
    populateChartSelect();
    drawPriceChart();
  } catch (err) {
    $('#bookBody').innerHTML = `<div class="empty">could not load book: ${esc(err.message)}</div>`;
  }
}

/* ------------------------------------------------------------------ charts */
function populateChartSelect() {
  const sel = $('#chartMarket');
  if (!sel) return;
  const opts = [];
  for (const e of state.events.slice(0, 25)) {
    for (const m of e.markets) opts.push([m.ticker, `${m.subtitle || m.ticker} — ${e.eventTicker}`]);
  }
  if (!opts.length) return;
  const keep = sel.value;
  sel.innerHTML = opts.map(([t, label]) => `<option value="${esc(t)}" ${t === state.chartMarket ? 'selected' : ''}>${esc(label)}</option>`).join('');
  if (!state.chartMarket) state.chartMarket = opts[0][0];
  if (keep && opts.find(([t]) => t === keep)) sel.value = keep;
}

function niceTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function drawPriceChart() {
  const canvas = $('#priceChart');
  if (!canvas) return;
  const ticker = state.chartMarket || $('#chartMarket')?.value;
  if (!ticker) return;
  let market;
  try {
    const r = await fetch(`/api/market/${encodeURIComponent(ticker)}`);
    market = (await r.json()).market;
  } catch {
    return;
  }
  if (!market) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 800;
  const cssH = Number(canvas.getAttribute('height')) || 240;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { l: 46, r: 12, t: 12, b: 22 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;

  const now = Date.now();
  const span = RANGE_MS[state.chartRange] || RANGE_MS['5m'];
  const t0 = now - span;
  const pts = (market.points || []).filter((p) => p.ts >= t0);

  // axes
  ctx.strokeStyle = '#243244';
  ctx.lineWidth = 1;
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = '#5f6f88';
  const fixed = $('#fixedAxis')?.checked;
  let lo = 0;
  let hi = 1;
  if (!fixed && pts.length) {
    lo = Math.min(...pts.map((p) => p.ticks)) / 1e6;
    hi = Math.max(...pts.map((p) => p.ticks)) / 1e6;
    const padY = Math.max(0.01, (hi - lo) * 0.15);
    lo = Math.max(0, lo - padY);
    hi = Math.min(1, hi + padY);
  }
  for (let i = 0; i <= 5; i += 1) {
    const y = pad.t + (h * i) / 5;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
    const val = hi - ((hi - lo) * i) / 5;
    ctx.fillText(`$${val.toFixed(2)}`, 6, y + 3);
  }
  ctx.fillText(niceTime(t0), pad.l, cssH - 6);
  ctx.fillText(niceTime(now), pad.l + w - 52, cssH - 6);

  if (pts.length < 2) {
    ctx.fillStyle = '#5f6f88';
    ctx.font = '12px system-ui';
    ctx.fillText('not enough points in this window yet', pad.l + 10, pad.t + 20);
    drawRangeBar();
    return;
  }

  const x = (ts) => pad.l + ((ts - t0) / span) * w;
  const y = (ticks) => pad.t + h - ((ticks / 1e6 - lo) / (hi - lo)) * h;
  const color = market.lastTicks > pts[0].ticks ? '#22c55e' : '#ef4444';

  // area fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
  grad.addColorStop(0, color === '#22c55e' ? 'rgba(34,197,94,0.20)' : 'rgba(239,68,68,0.20)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.beginPath();
  ctx.moveTo(x(pts[0].ts), pad.t + h);
  for (const p of pts) ctx.lineTo(x(p.ts), y(p.ticks));
  ctx.lineTo(x(pts[pts.length - 1].ts), pad.t + h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  const step = $('#stepChart')?.checked;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  let prev = null;
  for (const p of pts) {
    const px = x(p.ts);
    const py = y(p.ticks);
    if (!prev) ctx.moveTo(px, py);
    else if (step) {
      ctx.lineTo(px, prev.y);
      ctx.lineTo(px, py);
    } else ctx.lineTo(px, py);
    prev = { x: px, y: py };
  }
  ctx.stroke();

  // mark >=$0.10 jumps with a dot (uses real consecutive points only)
  ctx.fillStyle = '#f59e0b';
  for (let i = 1; i < pts.length; i += 1) {
    if (Math.abs(pts[i].ticks - pts[i - 1].ticks) >= 100_000) {
      ctx.beginPath();
      ctx.arc(x(pts[i].ts), y(pts[i].ticks), 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // last price label
  const last = pts[pts.length - 1];
  ctx.fillStyle = color;
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(`$${(last.ticks / 1e6).toFixed(2)}`, pad.l + w - 46, y(last.ticks) - 6);

  drawRangeBar();
}

function drawRangeBar() {
  const bar = $('#rangeBar');
  if (!bar || bar.dataset.built) return;
  bar.innerHTML = RANGES.map((r) => `<button data-range="${r}" class="${r === state.chartRange ? 'active' : ''}">${r}</button>`).join('');
  bar.querySelectorAll('button').forEach(
    (b) =>
      (b.onclick = () => {
        state.chartRange = b.dataset.range;
        bar.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.range === state.chartRange));
        drawPriceChart();
      })
  );
  bar.dataset.built = '1';
}

async function drawEquityChart(points) {
  const canvas = $('#equityChart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = 150;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const pad = { l: 54, r: 8, t: 8, b: 16 };
  const w = cssW - pad.l - pad.r;
  const h = cssH - pad.t - pad.b;
  if (!points || points.length < 2) {
    ctx.fillStyle = '#5f6f88';
    ctx.font = '11px system-ui';
    ctx.fillText('equity curve starts after the first closed paper trade', pad.l, 30);
    return;
  }
  const lo = Math.min(...points.map((p) => p.equityTicks));
  const hi = Math.max(...points.map((p) => p.equityTicks));
  const span = hi - lo || 1;
  const t0 = points[0].ts;
  const t1 = points[points.length - 1].ts || t0 + 1;
  ctx.strokeStyle = '#243244';
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = '#5f6f88';
  for (let i = 0; i <= 3; i += 1) {
    const y = pad.t + (h * i) / 3;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + w, y);
    ctx.stroke();
    ctx.fillText(`$${fmt2((hi - (span * i) / 3) / 1e6)}`, 4, y + 3);
  }
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = pad.l + ((p.ts - t0) / (t1 - t0 || 1)) * w;
    const y = pad.t + h - ((p.equityTicks - lo) / span) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = points[points.length - 1].equityTicks >= points[0].equityTicks ? '#22c55e' : '#ef4444';
  ctx.lineWidth = 1.6;
  ctx.stroke();
}

/* ---------------------------------------------------------------- portfolio */
let portfolioTimer = null;
function schedulePortfolioRefresh() {
  clearTimeout(portfolioTimer);
  portfolioTimer = setTimeout(() => {
    if (state.activeTab === 'portfolio') loadPortfolio();
  }, 1500);
}
function flashPaper() {
  const el = $('#mPaper');
  if (!el) return;
  el.style.transition = 'color .2s';
  el.style.color = '#fbbf24';
  setTimeout(() => (el.style.color = ''), 400);
}

async function loadPortfolio() {
  let d;
  try {
    d = await (await fetch('/api/analytics')).json();
  } catch {
    return;
  }
  const paper = d.paper || {};
  const start = paper.startTicks || 1;
  const eq = paper.equityTicks ?? start;
  const pnl = eq - start;
  $('#paperChip').textContent = `simulated · ${paper.openPositions?.length ?? 0} open · ${paper.pendingIntents?.length ?? 0} resting`;
  $('#paperCards').innerHTML = [
    ['Equity', moneyFromTicks(eq), `start ${moneyFromTicks(start)}`],
    ['P&L', `${pnl >= 0 ? '+' : ''}${moneyFromTicks(pnl)}`, `${((pnl / start) * 100).toFixed(2)}% of start`],
    ['Realized', moneyFromTicks(paper.realizedTicks), `${paper.closedCount ?? 0} closed trades`],
    ['Fees paid', moneyFromTicks(paper.feesTicks), 'official formula, K6'],
    ['Cash', moneyFromTicks(paper.cashTicks), `${paper.openPositions?.length ?? 0} open positions`]
  ]
    .map(([k, v, s]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`)
    .join('');
  drawEquityChart(paper.equityCurve || []);

  const live = d.live || {};
  $('#liveChip').textContent = live.connected ? 'connected' : live.credentialsPresent ? 'auth error' : 'not connected';
  $('#liveChip').className = `chip ${live.connected ? 'ok' : live.credentialsPresent ? 'warn' : 'no'}`;
  $('#liveBody').innerHTML = live.connected
    ? `<div class="cards">
        <div class="card"><div class="k">Balance</div><div class="v">${moneyFromTicks(live.balanceTicks)}</div><div class="s">GET /portfolio/balance</div></div>
        <div class="card"><div class="k">Portfolio value</div><div class="v">${moneyFromTicks(live.portfolioValueTicks)}</div><div class="s">separate field, not added to balance</div></div>
        <div class="card"><div class="k">Positions</div><div class="v">${live.positions?.length ?? 0}</div><div class="s">count_filter=position</div></div>
        <div class="card"><div class="k">Updated</div><div class="v" style="font-size:13px">${ago(live.lastBalanceAt)}</div><div class="s">balance changes on fills only</div></div>
      </div>
      <div class="footnote" style="border:0;padding:10px 0 0">Balance and portfolio value are two separate documented fields; there is no single "equity" field in the API, so they are not summed into one number here. <a href="https://docs.kalshi.com/api-reference/portfolio/get-balance" target="_blank" rel="noopener">source</a></div>`
    : `<div class="empty"><b>Demo account not connected.</b>Set <span class="mono">KALSHI_KEY_ID</span> and <span class="mono">KALSHI_PRIVATE_KEY_PATH</span> (or PEM env var) and restart. ${live.error ? `<br><span class="down">${esc(live.error.message || '')}</span>` : ''} <br>Paper results above are simulated and are never mixed with account results.</div>`;

  // categories table
  const groups = [
    ['Strategy', d.byStrategy],
    ['Topic', d.byTopic],
    ['Side', d.bySide],
    ['Entry price', d.byPriceBucket],
    ['Hold time', d.byHoldBucket],
    ['Exit reason', d.byExitReason],
    ['Fill type', d.byOutcomeKind]
  ];
  const rows = [];
  for (const [group, obj] of groups) {
    for (const [key, v] of Object.entries(obj || {})) {
      const thin = v.n < 10;
      rows.push(`<tr class="${thin ? 'mute' : ''}">
        <td>${esc(key)}</td><td class="dim">${esc(group)}</td>
        <td class="num">${v.n}${thin ? ' <span class="chip warn" title="sample too small to rank">thin</span>' : ''}</td>
        <td class="num ${v.pnlTicks > 0 ? 'up' : v.pnlTicks < 0 ? 'down' : ''}">${moneyFromTicks(v.pnlTicks)}</td>
        <td class="num">${moneyFromTicks(v.feesTicks)}</td>
        <td class="num">${v.winRate === null ? '—' : (v.winRate * 100).toFixed(0) + '%'}</td>
        <td class="num">${v.evPerContractTicks === null ? '—' : cents(v.evPerContractTicks)}</td>
        <td class="num">${v.avgHoldMs === null ? '—' : (v.avgHoldMs / 1000).toFixed(0) + 's'}</td>
        <td class="num">${v.profitFactor === null ? '—' : v.profitFactor}</td>
      </tr>`);
    }
  }
  $('#catBody').innerHTML = rows.length ? rows.join('') : `<tr><td colspan="9" class="empty"><b>No closed trades yet.</b>Paper trades appear once a promoted signal fills.</td></tr>`;

  // strategies
  let strat;
  try {
    strat = await (await fetch('/api/strategies')).json();
  } catch {
    strat = { strategies: [] };
  }
  $('#stratBody').innerHTML = (strat.strategies || [])
    .map((s) => {
      const m = s.measured || { n: 0 };
      const ranks = s.ranked || {};
      return `<tr>
      <td><b>${esc(s.name)}</b><div class="mute" style="font-size:10.5px">${esc(s.id)}</div></td>
      <td><span class="chip ${s.fillsAs === 'maker' ? 'ok' : 'warn'}">${esc(s.fillsAs)}</span></td>
      <td class="num">${m.n ?? 0}</td>
      <td class="num ${m.pnlTicks > 0 ? 'up' : m.pnlTicks < 0 ? 'down' : ''}">${moneyFromTicks(m.pnlTicks ?? 0)}</td>
      <td class="num">${m.winRate == null ? '—' : (m.winRate * 100).toFixed(0) + '%'}</td>
      <td class="num">${m.evPerContractTicks == null ? '—' : cents(m.evPerContractTicks)}</td>
      <td class="num">${ranks.maxDrawdownTicks == null ? '—' : moneyFromTicks(ranks.maxDrawdownTicks)}</td>
      <td class="dim" style="max-width:420px;font-size:11.5px">${esc(s.thesis)}</td>
    </tr>`;
    })
    .join('');
  const adv = strat.adverseSelection || {};
  $('#adverseNote').innerHTML = adv.n
    ? `Adverse selection on maker fills: <b>${(adv.adverseRate * 100).toFixed(0)}%</b> of ${adv.n} maker fills happened at a price worse than the contemporaneous mid — the documented cost of providing liquidity. Average drift at fill: ${cents(adv.avgDriftTicks)}.`
    : 'Adverse selection is measured once maker fills accumulate.';
}

/* ------------------------------------------------------------------- search */
function renderSearch() {
  const body = $('#searchBody');
  const q = ($('#searchBox')?.value || '').toLowerCase().trim();
  const rows = [];
  for (const e of state.events) for (const m of e.markets) rows.push({ ...m, eventTitle: e.eventTitle });
  const filtered = q
    ? rows.filter((m) => `${m.ticker} ${m.title} ${m.subtitle} ${m.eventTitle} ${m.topic}`.toLowerCase().includes(q))
    : rows;
  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">${q ? 'no matches' : 'no markets loaded yet'}</td></tr>`;
    return;
  }
  body.innerHTML = filtered
    .slice(0, 300)
    .map(
      (m) => `<tr class="mrow" data-ticker="${esc(m.ticker)}">
      <td class="ellipsis">${esc(m.subtitle || m.title)}</td>
      <td class="ticker">${esc(m.ticker)}</td>
      <td>${chipForTopic(m.topic)}</td>
      <td class="num">${priceFromTicks(m.yesBidTicks)}</td>
      <td class="num">${priceFromTicks(m.yesAskTicks)}</td>
      <td class="num">${m.book ? `${m.book.yesContracts} / ${m.book.noContracts}` : '—'}</td>
      <td class="num">${m.volumeContracts ?? '—'}</td>
      <td class="dim" style="font-size:11px">${esc(m.topicReason || '—')}</td>
    </tr>`
    )
    .join('');
}

/* --------------------------------------------------------------------- boot */
async function boot() {
  buildTabs();
  connect();
  try {
    const t = await (await fetch('/api/topics')).json();
    state.topics = t.topics || [];
    buildTabs();
  } catch {
    /* ignore */
  }
  try {
    state.status = await (await fetch('/api/status')).json();
    renderStatus();
  } catch {
    /* ignore */
  }
  await loadEvents();
  await loadTopic();
  drawPriceChart();
  populateChartSelect();

  $('#evSearch')?.addEventListener('input', renderEvents);
  $('#evRefresh')?.addEventListener('click', loadEvents);
  $('#searchBox')?.addEventListener('input', renderSearch);
  $('#chartMarket')?.addEventListener('change', (e) => {
    state.chartMarket = e.target.value;
    drawPriceChart();
  });
  $('#stepChart')?.addEventListener('change', drawPriceChart);
  $('#fixedAxis')?.addEventListener('change', drawPriceChart);
  $('#pause1')?.addEventListener('click', (e) => {
    state.chatPaused.all = !state.chatPaused.all;
    e.target.textContent = state.chatPaused.all ? 'resume' : 'pause';
    $('#chatAll').classList.toggle('paused', state.chatPaused.all);
  });
  $('#pause2')?.addEventListener('click', (e) => {
    state.chatPaused.model = !state.chatPaused.model;
    e.target.textContent = state.chatPaused.model ? 'resume' : 'pause';
    $('#chatModel').classList.toggle('paused', state.chatPaused.model);
  });

  // Keyboard-first navigation: 1-5 topics, l/p/r/s tabs, / to search.
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    const topicKeys = { 1: 'gas', 2: 'elections', 3: 'culture', 4: 'crypto', 5: 'golf' };
    if (topicKeys[e.key]) {
      state.activeTopic = topicKeys[e.key];
      showTab('topics');
      return;
    }
    if (e.key === 'l') showTab('live');
    if (e.key === 'p') showTab('portfolio');
    if (e.key === 'r') showTab('resolutions');
    if (e.key === 's') showTab('search');
    if (e.key === '/') {
      e.preventDefault();
      showTab('search');
      $('#searchBox')?.focus();
    }
  });

  // periodic refresh loops (WS carries the hot path; polling fills the slow parts)
  setInterval(loadEvents, 8000);
  setInterval(async () => {
    try {
      state.status = await (await fetch('/api/status')).json();
      renderStatus();
    } catch {
      /* ignore */
    }
  }, 5000);
  setInterval(() => {
    if (state.activeTab === 'live') {
      drawPriceChart();
      populateChartSelect();
    }
  }, 4000);
  setInterval(() => {
    if (state.activeTab === 'topics') loadTopic();
  }, 15000);
  setInterval(() => {
    if (state.activeTab === 'portfolio') loadPortfolio();
  }, 10000);
  $('#mClock').textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
  setInterval(() => {
    $('#mClock').textContent = new Date().toLocaleTimeString('en-US', { hour12: false });
  }, 1000);
}

boot();
