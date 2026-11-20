// Offline checks of the dashboard's pure logic against shapes taken from the
// official Kalshi docs (orderbook example) and live responses.
import assert from "node:assert/strict";
import {
  TOPICS, ALERT_THRESHOLD, ROI, bookSummary, bookDepth, candlePlan, classify,
  depthWithin, dollarVolume, fmt$, lastPrice, roiCheck, normTag, until, kalshiSeriesUrl,
} from "../docs/assets/app.js";

// --- price/volume helpers --------------------------------------------------
const market = {
  ticker: "KXETHD-26NOV2009-B1735",
  yes_bid_dollars: "0.5600", yes_ask_dollars: "0.5900",
  last_price_dollars: "0.5800", previous_price_dollars: "0.4500",
  volume_fp: "1200.00", open_interest_fp: "340.00",
};
assert.equal(lastPrice(market), 0.58);
assert.equal(lastPrice({ yes_bid_dollars: "0.42" }), 0.42, "falls back to bid only when last is absent");
assert.equal(lastPrice({}), null, "no price stays null, never zero");
assert.ok(Math.abs(dollarVolume(market) - 696) < 1e-9);

// --- order book maths, per docs.kalshi.com/getting_started/orderbook_responses
const ob = {
  yes_dollars: [["0.0100", "200.00"], ["0.4200", "13.00"]],
  no_dollars: [["0.0100", "100.00"], ["0.5600", "17.00"]],
};
const bs = bookSummary(ob);
assert.equal(bs.yesBid, 0.42);
assert.ok(Math.abs(bs.yesAsk - 0.44) < 1e-9, "implied YES ask = 1 - best NO bid");
assert.ok(Math.abs(bs.spread - 0.02) < 1e-9);
assert.equal(bookDepth(ob).total, 330);
assert.equal(depthWithin(ob, 0.03, "yes"), 13, "only levels within 3c of the best bid");

// --- ROI screen ------------------------------------------------------------
const pass = roiCheck({ price: 0.5, delta: 0.12, spread: 0.02, dollarVol: 900, depth: 200 });
assert.equal(pass.pass, true, JSON.stringify(pass.reasons));
const fail = roiCheck({ price: 0.95, delta: 0.12, spread: 0.3, dollarVol: 10, depth: 1 });
assert.equal(fail.pass, false);
assert.equal(fail.reasons.length, 4, fail.reasons.join(" | "));
assert.equal(ROI.minPrice, 0.15);
assert.equal(ALERT_THRESHOLD, 0.10);

// --- candle intervals must be legal (1 / 60 / 1440) ------------------------
for (const w of [60, 300, 900, 3600, 21600, 86400, 604800]) {
  const plan = candlePlan(w);
  assert.ok([1, 60, 1440].includes(plan.interval), `window ${w}`);
  assert.ok((w / plan.seconds) <= 5000, `period count within the documented cap for ${w}`);
}

// --- topic classification uses the event's category AND its series ----------
const topics = Object.fromEntries(TOPICS.map((t) => [t.id, new Set()]));
topics.crypto.add("KXETHD");
const events = [{ event_ticker: "E1", category: "Crypto", series_ticker: "KXETHD", title: "ETH" }];
const out = classify([{ ticker: "M1", event_ticker: "E1" }], events, topics);
assert.equal(out.length, 1);
assert.equal(out[0]._topic, "crypto");
assert.equal(classify([{ ticker: "M1", event_ticker: "E1" }], events, { ...topics, crypto: new Set() }).length, 0,
  "a market whose series is not in the topic map is excluded");

// --- tag normalisation: the API ships both spellings of the gas tag --------
assert.equal(normTag("Oil & Gas"), "oil and gas");
assert.equal(normTag("Oil and energy"), "oil and energy");
assert.equal(normTag("Golf"), "golf");

// --- formatting tells the truth about missing data -------------------------
assert.equal(fmt$(null), "—");
assert.equal(fmt$(1520), "$1.5k");
assert.equal(fmt$(2_400_000), "$2.40M");
assert.equal(until(null), "—");
assert.match(until(new Date(Date.now() + 3600_000).toISOString()), /^\d+h/);
assert.match(kalshiSeriesUrl("KXAAAGASM"), /^https:\/\/kalshi\.com\/markets\/kxaaagasm$/);
assert.equal(kalshiSeriesUrl(""), null);

console.log("logic tests passed");
