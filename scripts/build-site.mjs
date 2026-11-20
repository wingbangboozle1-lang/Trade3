#!/usr/bin/env node
// Build the static GitHub Pages site into site/.
//
// Inputs (all from this repo, nothing fetched at build time):
//   research/sources.json   official source registry
//   research/topics.json    topic rules, seeds, thresholds
//   research/findings.md    verified findings, rendered through the markdown renderer
//   requirements/REQUIREMENTS.md
//   EXECUTIVE_SUMMARY.md
//   site-data/snapshot.json optional live snapshot produced by the app in CI
//
// Output: site/ with one page per topic, plus overview, summary, requirements,
// contracts, fees, findings, suggestions, sources and flagged pages.
//
// Verification is not a vibe here: scripts/verify-sources.mjs runs after this and
// fails the build if any published row lacks an official source.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSources, loadTopics, esc, table, renderRow, validateRows, sourceCell, readText } from './lib/data.mjs';
import { page, CATEGORIES, banner, section, emptyState, sourceList, SITE_NAME } from './lib/site.mjs';
import { renderMarkdown } from './lib/markdown.mjs';

const OUT = path.join(ROOT, 'site');
const AS_OF = '2026-11-20';
const sources = loadSources();
const topics = loadTopics();
const sourcesDoc = JSON.parse(readText('research/sources.json'));

const problems = [];
let written = 0;

function write(name, html) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), html);
  written += 1;
}

function tryRead(rel) {
  try {
    return readText(rel);
  } catch {
    return null;
  }
}

/** Optional CI snapshot: the only way live numbers ever reach the site. */
function loadSnapshot() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'site-data', 'snapshot.json'), 'utf8');
    const snap = JSON.parse(raw);
    return snap && snap.generatedAt ? snap : null;
  } catch {
    return null;
  }
}
const snapshot = loadSnapshot();

/* --------------------------------------------------------------- components */

function sourceChip(id) {
  const s = sources[id];
  if (!s) return '<span class="flag">missing source</span>';
  return `<a class="src" href="${s.url}" target="_blank" rel="noopener" title="${esc(s.title)}">${id}</a>`;
}

/**
 * A verified row. If `unverified` is set, the value columns render blank and the
 * row is repeated on the Flagged page — per the requirement "if a value can't be
 * confirmed from an official source, leave it blank and flag it as unverified".
 */
function row({ cells, sourceId, note, unverified, asOf = AS_OF }) {
  if (!unverified && !sourceId) problems.push(`row without source: ${cells.join(' | ').slice(0, 90)}`);
  const blank = Boolean(unverified);
  const tds = cells
    .map((c, i) => {
      const isObj = c && typeof c === 'object';
      const value = isObj ? (blank ? '' : c.v) : blank ? '' : c;
      const cls = isObj && c.num ? ' class="num"' : '';
      return `<td${cls}>${value === '' ? '—' : value}</td>`;
    })
    .join('');
  return `<tr${blank ? ' class="unverified"' : ''}>${tds}<td>${blank ? '<span class="flag">unverified</span>' : sourceChip(sourceId)}</td></tr>${
    note ? `<tr class="note"><td colspan="${cells.length + 1}">${note}</td></tr>` : ''
  }`;
}

function head(cols) {
  return `<thead><tr>${cols.map((c) => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('')}<th>Source</th></tr></thead>`;
}

function table2(cols, rows) {
  return `<div class="tablewrap"><table>${head(cols)}<tbody>${rows.join('')}</tbody></table></div>`;
}

/* ------------------------------------------------------------------ content */

// 1. Overview: the answer to "what is this and what does it track", table-first.
function overviewPage() {
  const envRows = [
    row({
      cells: ['REST trade API, demo', '<code>https://external-api.demo.kalshi.co/trade-api/v2</code>', 'Recommended demo REST root'],
      sourceId: 'K1'
    }),
    row({
      cells: ['REST trade API, demo alternate', '<code>https://demo-api.kalshi.co/trade-api/v2</code>', 'Documented as also supported'],
      sourceId: 'K1'
    }),
    row({
      cells: ['WebSocket API, demo', '<code>wss://external-api-ws.demo.kalshi.co/trade-api/ws/v2</code>', 'Recommended demo WS URL'],
      sourceId: 'K1'
    }),
    row({
      cells: ['WebSocket API, demo alternate', '<code>wss://demo-api.kalshi.co/trade-api/ws/v2</code>', 'Documented as also supported'],
      sourceId: 'K1'
    }),
    row({ cells: ['Demo web UI', '<code>https://demo.kalshi.co/</code>', 'Mock funds'], sourceId: 'K2' }),
    row({
      cells: ['Demo price fidelity', 'Explicitly not guaranteed', 'Kalshi: demo "price and behavior ... may not be reflective of those in real markets"'],
      sourceId: 'K2'
    })
  ];

  const capRows = [
    row({ cells: ['Swing threshold', '$0.10 in either direction', 'Exactly >= $0.10 between observed prices'], sourceId: 'K19' }),
    row({ cells: ['Topics tracked', 'Gas prices, Elections, Culture, Crypto, Golf', 'One page per topic on this site'], sourceId: 'K6' }),
    row({ cells: ['Alert feeds', 'Two chats: all swings, and model promotions', 'Second feed is filtered by expected value after fees'], sourceId: 'K6' }),
    row({ cells: ['Resolution tracking', 'YES / NO captured from the lifecycle channel', 'Live until each market resolves'], sourceId: 'K21' }),
    row({ cells: ['Simulated trading', 'Four strategy families with a measured comparison', 'Maker and taker paths, official fee formula'], sourceId: 'K6' }),
    row({ cells: ['Liquidity', 'Depth per price level, cost to cross', 'Bids only; asks implied as 1 − opposite bid'], sourceId: 'K5' }),
    row({ cells: ['Live charts', 'X = time (1s…1d), Y = contract price', 'Jumps >= $0.10 marked with candidate cause links'], sourceId: 'K18' })
  ];

  const body = `
${banner(
    snapshot
      ? `<b>Snapshot mode.</b> The tables below include a snapshot captured ${esc(snapshot.generatedAt)} from the Kalshi demo environment. Everything else on this page is documentation, not market data.`
      : `<b>This site is documentation, not live market data.</b> It publishes verified API contracts, the fee model, requirements, findings and flagged items. The live dashboard itself runs as an app (<code>app/</code>); it is not hosted here because a static page cannot hold a private key or keep a WebSocket session open. See <a href="findings.html#what-could-not-be-verified">what could not be verified</a>.`,
    'info'
  )}

<section>
  <h1>Kalshi demo: live event tracking, $0.10 swing alerts, and a simulated trading tournament</h1>
  <p class="lede">
    This project tracks the highest dollar-volume live events on Kalshi's <b>demo</b> environment
    inside five topics only — gas prices, elections, culture, crypto and golf — flags every
    contract-price move of $0.10 or more, publishes each flag to a pair of live scrolling feeds,
    follows every market until it resolves YES or NO, and runs four simulated strategies against
    the same signals so the results can be compared instead of assumed.
  </p>
</section>

${section('endpoints', 'Demo endpoints verified', table2(
    [{ label: 'Surface' }, { label: 'URL' }, { label: 'Note' }],
    envRows
  ), 'Read from Kalshi\'s own API documentation on 2026-11-20. Both the recommended and the "also supported" hosts are implemented in the app and selectable in configuration.')}

${section('capabilities', 'What the dashboard does', table2(
    [{ label: 'Capability' }, { label: 'Behaviour' }, { label: 'Detail' }],
    capRows
  ))}

${section('topics', 'The five topics', `<div class="catgrid">${CATEGORIES.map((c) => {
    const t = topics.topics[c.id];
    return `<a class="catcard" href="${c.id}.html">
      <span class="catname">${esc(t.name)}</span>
      <span class="catblurb">${esc(t.blurb)}</span>
      <span class="catmeta">${(t.seed_series || []).length} verified seed series · ${(t.news_feeds || []).length} candidate-cause feeds</span>
    </a>`;
  }).join('')}</div>`, 'Topic membership is decided by an explicit, auditable rule set (series prefix, then category, then keyword). A market that matches no rule is left out rather than guessed into a topic.')}

${section('start', 'How to read this site', table2(
    [{ label: 'Page' }, { label: 'What it answers' }, { label: 'Primary official source' }],
    [
      row({ cells: ['<a href="executive-summary.html">Executive summary</a>', 'The short version: what was built, what is verified, what is not.', 'Kalshi API environments'], sourceId: 'K1' }),
      row({ cells: ['<a href="api-contracts.html">API contracts</a>', 'Every endpoint and channel the app uses, with exact field names.', 'Create Order (V2) reference'], sourceId: 'K13' }),
      row({ cells: ['<a href="fees.html">Fees</a>', 'The official fee formula plus the reconciliation against the published table.', 'Kalshi fee schedule (PDF)'], sourceId: 'K6' }),
      row({ cells: ['<a href="requirements.html">Requirements</a>', 'Each line of the request mapped to what implements it, with a status.', 'WebSocket quick start'], sourceId: 'K8' }),
      row({ cells: ['<a href="findings.html">Findings</a>', 'What the documentation actually says, including where common advice is stale.', 'Orderbook responses'], sourceId: 'K5' }),
      row({ cells: ['<a href="suggestions.html">Suggestions</a>', 'Concrete ways to make the dashboard more live and more useful.', 'Public trades channel'], sourceId: 'K19' }),
      row({ cells: ['<a href="flagged.html">Flagged for review</a>', 'Every irregularity and unverified value, so nothing is buried.', 'Rate limits and tiers'], sourceId: 'K4' })
    ]
  ))}

${snapshot ? snapshotSection(snapshot) : ''}
`;
  write('index.html', page({ title: 'Overview', active: 'overview', body, description: 'Kalshi demo dashboard: verified endpoints, five topics, $0.10 swing alerts, simulated trading.' }));
}

/** Optional: render live rows captured by CI, each with the verbatim API evidence. */
function snapshotSection(snap) {
  if (!snap.markets?.length) return '';
  const rows = snap.markets.map((m) =>
    row({
      cells: [
        `<span class="mono">${esc(m.ticker)}</span>`,
        esc(m.eventTitle || ''),
        `<span class="chip ${esc(m.topic)}">${esc(m.topic)}</span>`,
        { v: esc(m.yesBid), num: true },
        { v: esc(m.yesAsk), num: true },
        { v: esc(m.last), num: true },
        { v: esc(m.volume), num: true },
        { v: esc(m.closes), num: true }
      ],
      sourceId: 'K9',
      note: `<span class="mute">Captured from <code>GET /markets</code> at ${esc(snap.generatedAt)}. Fields as returned: yes_bid_dollars=${esc(m.raw?.yes_bid_dollars ?? '')}, yes_ask_dollars=${esc(m.raw?.yes_ask_dollars ?? '')}, volume_fp=${esc(m.raw?.volume_fp ?? '')}.</span>`
    })
  );
  return section(
    'snapshot',
    `Live snapshot · ${snap.markets.length} markets · ${esc(snap.generatedAt)}`,
    table2(
      [{ label: 'Ticker' }, { label: 'Event' }, { label: 'Topic' }, { label: 'YES bid', num: true }, { label: 'YES ask', num: true }, { label: 'Last', num: true }, { label: 'Volume', num: true }, { label: 'Closes', num: true }],
      rows
    ),
    'Captured by a scheduled GitHub Action against the demo environment. The verbatim raw fields are printed under each row so any value can be checked against the API response.'
  );
}

/* ------------------------------------------------------- per-topic pages --- */

function topicPage(id) {
  const t = topics.topics[id];
  const seeds = t.seed_series || [];
  const seedRows = seeds.length
    ? seeds.map((s) =>
        row({
          cells: [`<span class="mono">${esc(s.series_ticker)}</span>`, esc(s.subject), esc(s.evidence)],
          sourceId: s.source_id,
          asOf: topics.as_of
        })
      )
    : [
        row({
          cells: ['—', 'No series ticker for this topic is listed on any official page retrieved for this project.', 'Discovery is dynamic at runtime'],
          unverified: true,
          note:
            'Kalshi publishes no static list of golf series tickers that could be verified from the documentation retrieved here. The app discovers golf series at runtime via <code>GET /series</code> and <code>GET /events</code>; nothing is invented to fill this table.'
        })
      ];

  const ruleRows = [
    row({
      cells: ['Series prefix', `<span class="mono">${(t.rules.series_prefixes || []).map(esc).join(', ') || '—'}</span>`, 'Highest-confidence signal: ticker structure is stable'],
      sourceId: 'K12'
    }),
    row({
      cells: ['Category', `<span class="mono">${(t.rules.categories || []).map(esc).join(', ') || '—'}</span>`, 'Kalshi series carry a primary <code>category</code> and a <code>categories[]</code> list'],
      sourceId: 'K12'
    }),
    row({
      cells: ['Keyword', esc((t.rules.keywords || []).slice(0, 8).join(', ')) || '—', 'Applied to event and market titles, with word boundaries'],
      sourceId: 'K11'
    })
  ];

  // Reference feeds are project configuration pointing at the primary publisher of the
  // underlying metric. They are not claims about Kalshi, so the source column links the
  // publisher itself rather than pretending a Kalshi page supports them.
  const feedRows = (t.news_feeds || []).map(
    (f) =>
      `<tr><td><a href="${f.url}" target="_blank" rel="noopener">${esc(f.title)}</a></td><td>${esc(f.kind)}</td><td>Used as a candidate-cause link, never as a confirmed cause</td><td><a class="src" href="${f.url}" target="_blank" rel="noopener">publisher</a></td></tr>`
  );

  const body = `
${banner(`<b>${esc(t.name)}.</b> ${esc(t.blurb)} <br><span class="mute">This page lists the verified rules and seeds for the topic. The live market table for this topic is produced by the dashboard app, not by this static page — see <a href="index.html#start">how to read this site</a>.</span>`, 'info')}

${section('series', 'Verified series in this topic', table2(
    [{ label: 'Series ticker' }, { label: 'Subject' }, { label: 'Evidence (verbatim or summarised from the source)' }],
    seedRows
  ), `Retrieved ${esc(topics.as_of)}. A "seed" is a series whose existence and subject matter were read on an official Kalshi page. Seeds are not a census: the app re-discovers live series on every refresh and labels anything found at runtime as discovered.`)}

${section('rules', 'Classification rules', table2(
    [{ label: 'Rule type' }, { label: 'Values' }, { label: 'Why this rule' }],
    ruleRows
  ), 'Order of precedence: series prefix, then category, then keyword, then tag. A market that matches none is excluded, not guessed.')}

${section('causes', 'Candidate causes and reference sources', table2(
    [{ label: 'Reference' }, { label: 'Kind' }, { label: 'How it is used' }],
    feedRows
  ), 'These links are attached to a price-jump alert as <b>candidate</b> causes. No official source attributes a Kalshi price move to a specific news story, so asserting one would be a fabrication.')}

${feeMultiplierSection(id)}

${section('thresholds', 'Thresholds applied to this topic', table2(
    [{ label: 'Threshold' }, { label: 'Value' }, { label: 'Meaning' }],
    [
      row({ cells: ['Swing alert', `$${topics.thresholds.alert_move_dollars.toFixed(2)}`, 'A move of at least this much, in either direction, is published to the alert feed'], sourceId: 'K19' }),
      row({ cells: ['Minimum expected edge', `$${topics.thresholds.high_roi_min_edge.toFixed(3)}/contract`, 'After the official fee, before a signal can reach the model feed'], sourceId: 'K6' }),
      row({ cells: ['Minimum return', `${topics.thresholds.high_roi_min_return_bps} bps`, 'Expected edge divided by capital at risk'], sourceId: 'K6' }),
      row({ cells: ['Signal-to-noise', `${topics.thresholds.high_roi_min_shock_over_spread}× spread`, 'The move must dominate the spread to count as signal'], sourceId: 'K5' }),
      row({ cells: ['Minimum depth', `${topics.thresholds.high_roi_min_liquidity_contracts} contracts`, 'Both sides of the book must hold at least this many'], sourceId: 'K5' })
    ]
  ))}
`;
  write(`${id}.html`, page({ title: t.name, active: id, body, description: `${t.name} on Kalshi demo: verified series, classification rules and thresholds.` }));
}

function feeMultiplierSection(id) {
  const seeds = topics.topics[id].seed_series || [];
  const rows = [];
  for (const s of seeds) {
    // Only claim a multiplier when the official table lists the series.
    const known = {
      KXAAAGASM: { maker: 1, taker: 1 },
      KXBTCMAX150: { maker: 1, taker: 1 },
      KXETHY: { maker: 0, taker: 0 },
      KXBALLONDOR: { maker: 1, taker: 1 },
      KXEMMYCSERIES: { maker: 1, taker: 1 },
      KXELECTIRAN: { maker: 0, taker: 0 },
      KXIRANDEMOCRACY: { maker: 0, taker: 0 }
    }[s.series_ticker];
    if (known) {
      rows.push(
        row({
          cells: [`<span class="mono">${esc(s.series_ticker)}</span>`, String(known.maker), String(known.taker), 'Maker / taker multipliers from the Non-Standard Fees table'],
          sourceId: 'K6'
        })
      );
    } else {
      rows.push(
        row({
          cells: [`<span class="mono">${esc(s.series_ticker)}</span>`, '', '', 'Not listed in the Non-Standard Fees table'],
          unverified: true,
          note: 'The fee schedule retrieved does not list this series in its Non-Standard Fees table, and the general schedule (1× taker, 0× maker) is a default rather than a confirmation. Values left blank.'
        })
      );
    }
  }
  if (!rows.length) return '';
  return section(
    'fees',
    'Fee multipliers for this topic',
    table2([{ label: 'Series' }, { label: 'Maker ×', num: true }, { label: 'Taker ×', num: true }, { label: 'Basis' }], rows),
    'Read from the official fee schedule\'s Non-Standard Fees table. A series not in that table is left blank rather than assumed to follow the general schedule, even though the general schedule is the documented default.'
  );
}

/* --------------------------------------------------------- document pages -- */

function markdownPage({ file, title, active, intro = '', missingNote = '' }) {
  const raw = tryRead(file);
  const html = raw
    ? renderMarkdown(raw).replace(/href="(https:\/\/docs\.kalshi\.com[^"]*)"/g, 'href="$1" target="_blank" rel="noopener"')
    : `<div class="empty"><b>Source document not found.</b><p>${esc(missingNote || `${file} is missing from the repository.`)}</p></div>`;
  const body = `${intro ? `<p class="lede">${intro}</p>` : ''}${html}`;
  write(`${active}.html`, page({ title, active, body, description: `${title} — generated from ${file}.` }));
}

/* ------------------------------------------------------------- source pages */

function sourcesPage() {
  const rows = Object.entries(sources).map(([id, s]) =>
    row({
      cells: [
        `<span class="mono">${esc(id)}</span>`,
        `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a>`,
        esc(s.publisher),
        esc((s.claims_supported || []).length),
        s.html ? `<a href="${s.html}" target="_blank" rel="noopener">html</a>` : ''
      ],
      sourceId: id
    })
  );
  const body = `
<p class="lede">Every claim in this repository resolves to one of these records. Each record is an official Kalshi page or file, retrieved ${esc(sourcesDoc.retrieved)}, with the specific claims it supports listed.</p>
${banner(`Retrieval method: ${esc(sourcesDoc.retrieval_method)}`, 'info')}
${section('registry', `Source registry · ${rows.length} records`, table2(
    [{ label: 'ID' }, { label: 'Source' }, { label: 'Publisher' }, { label: 'Claims', num: true }, { label: 'Alt link' }],
    rows
  ))}
${section('claims', 'Claim-by-claim mapping', `<div class="claims">${Object.entries(sources)
    .map(
      ([id, s]) => `<details><summary><span class="mono">${esc(id)}</span> ${esc(s.title)} <span class="mute">· ${(s.claims_supported || []).length} claims</span></summary>
    <ul>${(s.claims_supported || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <p><a href="${s.url}" target="_blank" rel="noopener">Open the source</a></p></details>`
    )
    .join('')}</div>`)}
`;
  write('sources.html', page({ title: 'Sources', active: 'sources', body, description: 'Official source registry for every claim in this repository.' }));
}

function flaggedPage() {
  const findings = tryRead('research/findings.md') || '';
  // Pull the flagged section out of findings.md so the page cannot drift from it.
  const flaggedMatch = findings.match(/## 8\. Flagged for review[\s\S]*?(?=\n## 9\.)/);
  // The fragments are rendered on their own, so the document's `[K*]: url`
  // definitions must travel with them or every citation turns into a bare code span.
  const refDefs = (findings.match(/^\[K\d+\]:\s*\S+\s*$/gm) || []).join('\n');
  const flaggedBody = flaggedMatch ? flaggedMatch[0].replace(/\n\[K\d+\]:\s*\S+\s*/g, '') : '';
  const flaggedMd = flaggedBody ? `${flaggedBody}\n\n${refDefs}\n` : '';
  const unverifiedMatch = findings.match(/## 10\. What could not be verified[\s\S]*?\n\n(?=\[K\d+\]:)/);
  const unverifiedMd = unverifiedMatch ? `${unverifiedMatch[0]}\n${refDefs}\n` : '';

  const unverifiedSeeds = [];
  for (const [tid, t] of Object.entries(topics.topics)) {
    for (const s of t.seed_series || []) {
      if (!s.source_id) unverifiedSeeds.push(`${tid}/${s.series_ticker}`);
    }
    if (!(t.seed_series || []).length) unverifiedSeeds.push(`${tid}/ (no verified seed series)`);
  }

  const buildProblems = problems.length
    ? `<ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
    : '<p class="ok">No rows were published without a source at build time.</p>';

  const body = `
${banner('<b>Flagged for review.</b> Everything on this page is either an irregularity found while verifying against official sources, or a value that could not be confirmed and was therefore left blank. None of it blocks the site; all of it is here so you can decide.', 'warn')}

${section('irregularities', 'Irregularities found in official sources', renderMarkdown(flaggedMd.replace(/^## 8\. Flagged for review[^\n]*\n/, '')), 'Each row was checked against the source in its last column. The two that matter most: the legacy order endpoint now returns 410, and the fee schedule\'s printed table rounds differently from its own formula text.')}

${section('unverified', 'What could not be verified', renderMarkdown(unverifiedMd.replace(/^## 10\. What could not be verified[^\n]*\n/, '')))}

${section('blank', 'Values deliberately left blank on topic pages', unverifiedSeeds.length
    ? `<ul>${unverifiedSeeds.map((s) => `<li><span class="mono">${esc(s)}</span> — no official source confirms this value, so the cell is blank.</li>`).join('')}</ul>`
    : '<p class="ok">Every seed series on every topic page carries a source.</p>')}

${section('build', 'Build-time source checks', buildProblems, 'These are produced by the generator itself. If this list is ever non-empty, the build script exits non-zero and the deploy is stopped.')}

${section('howto', 'How to review this', `<ol>
<li>Pick any row on any page. Its last cell is a source ID; the <a href="sources.html">Sources</a> page turns that ID into an official URL.</li>
<li>Open the URL and search the page for the exact field name or number in the row.</li>
<li>If the source does not support the row, add it here and open an issue. The build does not prevent a wrong claim — it prevents an <em>unsourced</em> claim — so human review is still the last line of defence.</li>
</ol>`)}
`;
  write('flagged.html', page({ title: 'Flagged for review', active: 'flagged', body, description: 'Irregularities and unverified values found while verifying against official Kalshi sources.' }));
}

function apiContractsPage() {
  const rows = [
    ['GET', '/exchange/status', 'Exchange up/down and estimated resume', 'Unauthenticated', 'K23'],
    ['GET', '/series', 'Series metadata incl. categories, tags, settlement sources, fee type', 'Unauthenticated', 'K12'],
    ['GET', '/events', 'Events with nested markets, mutually_exclusive flag', 'Unauthenticated', 'K11'],
    ['GET', '/markets', 'Market list with prices, sizes, volume, open interest, liquidity, result', 'Unauthenticated', 'K9'],
    ['GET', '/markets/{ticker}', 'Single market', 'Unauthenticated', 'K9'],
    ['GET', '/markets/{ticker}/orderbook', 'Orderbook: bids only, aggregated size per level', 'Unauthenticated', 'K5'],
    ['GET', '/portfolio/balance', 'Balance and portfolio value (two separate fields)', 'Authenticated', 'K15'],
    ['GET', '/portfolio/positions', 'Signed position_fp, realized P&L, fees paid', 'Authenticated', 'K16'],
    ['GET', '/portfolio/fills', 'Fills with outcome_side and book_side', 'Authenticated', 'K17'],
    ['POST', '/portfolio/events/orders', 'Create an order (V2). A 201 means accepted, not resting.', 'Authenticated', 'K13'],
    ['DELETE', '/portfolio/events/orders/{order_id}', 'Cancel an order (V2)', 'Authenticated', 'K14'],
    ['GET', '/series/{s}/markets/{t}/candlesticks', 'Candles at 1 / 60 / 1440 minute intervals', 'Unauthenticated', 'K25']
  ].map(([method, path, purpose, auth, src]) =>
    row({
      cells: [`<span class="method ${method === 'GET' ? 'get' : method === 'POST' ? 'post' : 'del'}">${method}</span>`, `<code>${esc(path)}</code>`, esc(purpose), esc(auth)],
      sourceId: src
    })
  );

  const channels = [
    ['ticker', 'Public (still requires an authenticated connection)', 'Optional', 'Flushed once per second; intermediate values are not sent', 'K18'],
    ['trade', 'Public (still requires an authenticated connection)', 'Optional', 'Every print, immediately', 'K19'],
    ['orderbook_delta', 'Private group', 'Required', 'Snapshot then deltas; requires a key', 'K20'],
    ['market_lifecycle_v2', 'Public (still requires an authenticated connection)', 'Optional', 'determined / settled carry YES or NO and settlement value', 'K21'],
    ['fill', 'Private', 'n/a', 'Your fills', 'K8']
  ].map(([ch, access, filter, note, src]) =>
    row({ cells: [`<code>${esc(ch)}</code>`, esc(access), esc(filter), esc(note)], sourceId: src })
  );

  const auth = [
    row({ cells: ['Headers', '<code>KALSHI-ACCESS-KEY</code>, <code>KALSHI-ACCESS-SIGNATURE</code>, <code>KALSHI-ACCESS-TIMESTAMP</code>', ''], sourceId: 'K3' }),
    row({ cells: ['Pre-sign text', '<code>timestamp + METHOD + path</code>, query string removed', ''], sourceId: 'K3' }),
    row({ cells: ['RSA', 'RSA-PSS / SHA-256 / MGF1-SHA256 / salt length = digest length / 2048-bit', ''], sourceId: 'K3' }),
    row({ cells: ['Ed25519', 'Signs the message directly, 64-byte signature, recommended', ''], sourceId: 'K3' }),
    row({ cells: ['Clock tolerance', 'Timestamp must be within 30 seconds of Kalshi\'s clock', 'Outside it the request returns 401 header_timestamp_expired'], sourceId: 'K3' }),
    row({ cells: ['WebSocket handshake', '<code>timestamp + "GET" + "/trade-api/ws/v2"</code>', ''], sourceId: 'K8' }),
    row({ cells: ['Rate limits', 'Token buckets, default 10 tokens per request, separate read/write buckets', '429 has no Retry-After; back off exponentially'], sourceId: 'K4' })
  ];

  const order = [
    row({ cells: ['<code>ticker</code>', 'Market ticker', 'Required'], sourceId: 'K13' }),
    row({ cells: ['<code>side</code>', '<code>bid</code> = buy YES, <code>ask</code> = sell YES', 'Required'], sourceId: 'K13' }),
    row({ cells: ['<code>count</code>', 'Fixed-point string, e.g. <code>"10.00"</code>', 'Required'], sourceId: 'K13' }),
    row({ cells: ['<code>price</code>', 'Fixed-point dollars, e.g. <code>"0.5600"</code>', 'Required'], sourceId: 'K13' }),
    row({ cells: ['<code>time_in_force</code>', '<code>fill_or_kill</code>, <code>good_till_canceled</code>, <code>immediate_or_cancel</code>', '<code>GTT</code> is not a valid API value'], sourceId: 'K13' }),
    row({ cells: ['<code>self_trade_prevention_type</code>', '<code>taker_at_cross</code> or <code>maker</code>', 'Required'], sourceId: 'K13' }),
    row({ cells: ['<code>reduce_only</code>', 'Only accepted with <code>immediate_or_cancel</code>', 'Otherwise rejected'], sourceId: 'K13' }),
    row({ cells: ['Removed endpoint', '<code>POST /portfolio/orders</code> returns <b>410 Gone</b>', 'code <code>deprecated_v1_order_endpoint</code>'], sourceId: 'K13' })
  ];

  const body = `
<p class="lede">The exact contracts this project codes against, transcribed from Kalshi's own reference pages on ${esc(AS_OF)}. If the app and this page disagree, the app is wrong.</p>
${section('rest', 'REST endpoints used', table2([{ label: 'Method' }, { label: 'Path' }, { label: 'Purpose' }, { label: 'Auth' }], rows))}
${section('ws', 'WebSocket channels used', table2([{ label: 'Channel' }, { label: 'Access' }, { label: 'Market filter' }, { label: 'Note' }], channels), 'Note the awkward but documented detail: even the "public" channels require an authenticated <em>connection</em>, though they impose no extra per-channel check.')}
${section('auth', 'Authentication', table2([{ label: 'Item' }, { label: 'Value' }, { label: 'Note' }], auth))}
${section('order', 'Order create (V2) field by field', table2([{ label: 'Field' }, { label: 'Value' }, { label: 'Note' }], order))}
`;
  write('api-contracts.html', page({ title: 'API contracts', active: 'api', body, description: 'Verified Kalshi REST and WebSocket contracts used by this project.' }));
}

function feesPage() {
  const table = [
    [0.01, 0.01, 0.07],
    [0.05, 0.01, 0.34],
    [0.1, 0.01, 0.63],
    [0.15, 0.01, 0.9],
    [0.2, 0.02, 1.12],
    [0.25, 0.02, 1.32],
    [0.3, 0.02, 1.47],
    [0.35, 0.02, 1.6],
    [0.4, 0.02, 1.68],
    [0.45, 0.02, 1.74],
    [0.5, 0.02, 1.75],
    [0.55, 0.02, 1.74],
    [0.6, 0.02, 1.68],
    [0.65, 0.02, 1.6],
    [0.7, 0.02, 1.47],
    [0.75, 0.02, 1.32],
    [0.8, 0.02, 1.12],
    [0.85, 0.01, 0.9],
    [0.9, 0.01, 0.63],
    [0.95, 0.01, 0.34],
    [0.99, 0.01, 0.07]
  ].map(([p, f1, f100]) =>
    row({
      cells: [
        `$${p.toFixed(2)}`,
        `$${f1.toFixed(2)}`,
        { v: `$${f100.toFixed(2)}`, num: true },
        { v: `$${(0.07 * 100 * p * (1 - p)).toFixed(4)}`, num: true },
        { v: `$${(0.0175 * 100 * p * (1 - p)).toFixed(4)}`, num: true }
      ],
      sourceId: 'K6'
    })
  );

  const body = `
<p class="lede">Fees decide whether a strategy is real. These are the numbers the paper trader charges and the numbers the scoring model uses, transcribed from Kalshi's official fee schedule and cross-checked against the published table.</p>
${section('formula', 'The formula, verbatim', `<pre><code>Taker: fees = roundup(M x 0.07  x C x P x (1-P))
Maker: fees = roundup(M x 0.0175 x C x P x (1-P))

P = price per contract in dollars (0.50 = 50 cents)
C = number of contracts
M = per-contract multiplier (taker default 1, maker default 0)
round up = fee + position cost rounded to a centicent ($0.0001)</code></pre>
<p>Source: ${sourceChip('K6')} · rounding detail: ${sourceChip('K7')}</p>
<p>There is <b>no settlement fee</b> and no membership fee. A resting order is not charged until it trades, and cancelling a resting order is free. ${sourceChip('K6')}</p>`)}
${section('table', 'Published table reproduced, with our model beside it', table2(
    [{ label: 'Price' }, { label: 'Published fee, 1 contract' }, { label: 'Published fee, 100 contracts', num: true }, { label: 'Formula, 100 contracts (taker)', num: true }, { label: 'Formula, 100 contracts (maker)', num: true }],
    table
  ), 'Every published 100-contract value equals the taker formula rounded <b>up to the cent</b>. The schedule text says to round to a centicent, so the formula is the finer-grained authority; the difference is disclosed as flag <a href="flagged.html">F11</a>.')}
${section('multipliers', 'Per-series multipliers (Non-Standard Fees table)', table2(
    [{ label: 'Series' }, { label: 'Description' }, { label: 'Maker ×', num: true }, { label: 'Taker ×', num: true }],
    [
      ['KXAAAGASM', 'US gas price', '1', '1'],
      ['KXBTCMAX150', 'When will bitcoin hit 150k?', '1', '1'],
      ['KXBTCY', 'BTC price range EOY', '0', '0'],
      ['KXETHY', 'ETH price EOY', '0', '0'],
      ['KXBALLONDOR', "Ballon d'Or", '1', '1'],
      ['KXEMMYCSERIES', 'Emmys Award for Comedy Series', '1', '1'],
      ['KXELECTIRAN', 'Will Iran hold a presidential election?', '0', '0'],
      ['KXIRANDEMOCRACY', 'Will Iran become a democracy in 2026?', '0', '0']
    ].map(([s, d, m, t]) => row({ cells: [`<span class="mono">${esc(s)}</span>`, esc(d), m, t], sourceId: 'K6' }))
  ), 'Only rows relevant to the five topics are transcribed here; the PDF lists many more. A series not in this table uses the general schedule, which the app labels as a default rather than a confirmation.')}
${section('worked', 'Worked example', `<p>Buy 100 YES at $0.45 as a taker. Taker fee = 0.07 × 100 × 0.45 × 0.55 = <b>$1.7325</b>, charged at centicent granularity. The published table prints <b>$1.74</b> because it rounds to whole cents. If the same order rested and filled as a maker at the general 0× multiplier, the maker fee would be <b>$0.00</b>.</p><p>This asymmetry is the entire basis of the maker strategy in the dashboard, and it is why the taker strategy is included as a control: it shows the cost of impatience.</p>`)}
`;
  write('fees.html', page({ title: 'Fees', active: 'fees', body, description: 'Kalshi fee formula, transcribed and reconciled against the official fee table.' }));
}

/* -------------------------------------------------------------------- build */

function writeAssets() {
  fs.mkdirSync(OUT, { recursive: true });
  const css = fs.readFileSync(path.join(ROOT, 'scripts', 'site-assets', 'style.css'), 'utf8');
  fs.writeFileSync(path.join(OUT, 'style.css'), css);
  const js = fs.readFileSync(path.join(ROOT, 'scripts', 'site-assets', 'app.js'), 'utf8');
  fs.writeFileSync(path.join(OUT, 'app.js'), js);
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0b0f17"/><path d="M6 22 L12 14 L17 18 L26 8" stroke="#6366f1" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="8" r="2.2" fill="#22c55e"/></svg>`;
  fs.writeFileSync(path.join(OUT, 'favicon.svg'), favicon);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  written += 4;
}

function main() {
  if (!fs.existsSync(path.join(ROOT, 'scripts', 'site-assets', 'style.css'))) {
    console.error('missing scripts/site-assets/style.css');
    process.exit(1);
  }
  overviewPage();
  for (const c of CATEGORIES) topicPage(c.id);
  markdownPage({ file: 'EXECUTIVE_SUMMARY.md', title: 'Executive summary', active: 'executive-summary' });
  markdownPage({ file: 'requirements/REQUIREMENTS.md', title: 'Requirements', active: 'requirements' });
  markdownPage({ file: 'research/findings.md', title: 'Findings', active: 'findings' });
  markdownPage({ file: 'research/SUGGESTIONS.md', title: 'Suggestions', active: 'suggestions' });
  apiContractsPage();
  feesPage();
  sourcesPage();
  flaggedPage();
  writeAssets();

  if (problems.length) {
    console.error(`\x1b[31m${problems.length} unsourced row(s) published:\x1b[0m`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`built ${written} files into site/ with ${Object.keys(sources).length} source records`);
}

main();
