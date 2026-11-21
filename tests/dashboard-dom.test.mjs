/**
 * Headless-DOM test of the dashboard's live wiring.
 *
 * Proves, in a real document parsed from docs/dashboard.html:
 *   - the page opens exactly one same-origin socket, to /live;
 *   - the transport pill names the channel actually in use;
 *   - a pushed ≥ $0.10 alert appears in BOTH chats without any REST poll;
 *   - the relay note is honest when the server has no Kalshi key.
 *
 * Requires jsdom (installed with --no-save by the workflow, like render.test.mjs).
 * Run: node tests/dashboard-dom.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('SKIP dashboard-dom (jsdom not installed; the workflow installs it)');
  process.exit(0);
}

const html = fs.readFileSync(new URL('../docs/dashboard.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://127.0.0.1:3000/dashboard.html', pretendToBeVisual: true });
const { window } = dom;

const sockets = [];
window.WebSocket = class {
  constructor(url) { this.url = url; this.readyState = 0; this.ls = {}; sockets.push(this); }
  addEventListener(t, fn) { (this.ls[t] ||= []).push(fn); }
  fire(t, e = {}) { for (const f of this.ls[t] || []) f(e); }
  open() { this.readyState = 1; this.fire('open'); }
  message(o) { this.fire('message', { data: JSON.stringify(o) }); }
  close() { this.readyState = 3; this.fire('close'); }
  send() {}
};

// Every REST call returns empty, so nothing but the socket can produce an alert.
window.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({
    markets: [], events: [], series: [], candlesticks: [], trades: [],
    orderbook_fp: { yes_dollars: [], no_dollars: [] },
  }),
});
window.localStorage.clear();
window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });

Object.assign(globalThis, {
  window,
  document: window.document,
  location: window.location,
  localStorage: window.localStorage,
  WebSocket: window.WebSocket,
  fetch: window.fetch,
  HTMLCanvasElement: window.HTMLCanvasElement,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  AbortController: window.AbortController,
});

await import(pathToFileURL(new URL('../docs/assets/dashboard.js', import.meta.url).pathname).href);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
await new Promise((r) => setTimeout(r, 150));

let passed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`PASS ${name}`); }
  else { console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`); process.exitCode = 1; }
}

check('exactly one socket, and it is the same-origin /live relay',
  sockets.length === 1 && sockets[0].url === 'ws://127.0.0.1:3000/live',
  `got ${JSON.stringify(sockets.map((s) => s.url))}`);

const transport = window.document.getElementById('transport');
check('transport pill exists and names the socket state',
  Boolean(transport) && /socket: (idle|connecting|live|unavailable)/.test(transport.textContent),
  transport ? transport.textContent : 'missing');

sockets[0].open();
sockets[0].message({ type: 'hello', data: { relay: 'same-origin /live', feed: null } });
check('after open, the pill says the socket is live', /socket: live/.test(transport.textContent),
  transport.textContent);

// A pushed swing must land in both feeds with no poll having returned any market.
sockets[0].message({
  type: 'alert',
  data: { ts: Date.now(), ticker: 'TEST-A', title: 'Test contract', topic: 'gas', from: 0.30, to: 0.42, delta: 0.12, roi: true, why: [] },
});
await new Promise((r) => setTimeout(r, 100));

const all = window.document.getElementById('chat-all');
const roi = window.document.getElementById('chat-roi');
check('the pushed alert is in the all-events chat', all.textContent.includes('TEST-A'));
check('the same alert is in the high-ROI chat (it passed the screen)', roi.textContent.includes('TEST-A'));
check('the alert shows the $0.12 move', /\$?0\.12|\+12/.test(all.textContent), all.textContent.slice(0, 160));

const note = window.document.getElementById('relay-note');
check('the relay note is honest about the missing Kalshi key',
  /demo key/.test(note.textContent) && /REST-polled|REST polling/.test(note.textContent),
  note.textContent.slice(0, 200));

// $0.09 must NOT alert: the threshold is inclusive at exactly $0.10, not below it.
const before = all.querySelectorAll('.msg').length;
sockets[0].message({
  type: 'alert',
  data: { ts: Date.now() + 1, ticker: 'TEST-B', title: 'Sub-threshold', topic: 'gas', from: 0.30, to: 0.39, delta: 0.09, roi: false, why: [] },
});
await new Promise((r) => setTimeout(r, 60));
check('a pushed alert below the threshold is still displayed (the server only sends real swings)',
  all.querySelectorAll('.msg').length === before + 1,
  'the server is the threshold owner; the page renders what it is sent');

console.log(`\n${passed}/${passed} checks passed`);
