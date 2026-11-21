// Offline checks of the dashboard's pure logic against shapes taken from the
// official Kalshi docs (orderbook example) and live responses.
import assert from "node:assert/strict";
import {
  TOPICS, ALERT_THRESHOLD, ROI, bookSummary, bookDepth, candlePlan, classify,
  depthWithin, dollarVolume, fmt$, isSwing, lastPrice, movedTicks, roiCheck, normTag, ticks, until, kalshiSeriesUrl,
  cleanTitle, sourceLinks,
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
// +2h of slack: the formatter is exact-to-the-second, so an input placed exactly on the hour
// boundary can land at 3599 s and legitimately render as "59m".
assert.match(until(new Date(Date.now() + 2 * 3600_000).toISOString()), /^\d+h/);
assert.match(kalshiSeriesUrl("KXAAAGASM"), /^https:\/\/kalshi\.com\/markets\/kxaaagasm$/);
assert.equal(kalshiSeriesUrl(""), null);

// --- titles: Kalshi ships markdown inside some titles (live demo, 2026-11-20) ---
// GET /markets?series_ticker=KXAAAGASM returned  title: "Will average **gas prices** be above $5.00?"
assert.equal(cleanTitle("Will average **gas prices** be above $5.00?"), "Will average gas prices be above $5.00?");
assert.equal(cleanTitle("*italics* and `code`"), "italics and code");
assert.equal(cleanTitle(null), "", "null title becomes empty, never \"null\"");
assert.equal(cleanTitle("  spaced   out  "), "spaced out", "only whitespace is normalised, words are never edited");
assert.equal(cleanTitle("above $5.00?"), "above $5.00?", "plain titles pass through untouched");

// --- the culture mapping is Kalshi's real category, with Entertainment as a declared superset ---
// Live evidence 2026-11-20: GET /series?category=Culture -> 2 series with "category":"Culture";
// GET /markets?series_ticker=KXXBANNEDGROK&status=open -> {"markets":[]}; no Gas/Golf category exists.
const culture = TOPICS.find((t) => t.id === "culture");
assert.equal(culture.category, "Culture", "Kalshi does have a Culture category — do not map the topic away from it");
assert.deepEqual(culture.extraCategories, ["Entertainment"], "Entertainment is allowed only as a labelled superset");
for (const t of TOPICS) {
  assert.notEqual(t.category, "Gas", "GET /series?category=Gas returns {\"series\":null} — never filter on it");
  assert.notEqual(t.category, "Golf", "GET /series?category=Golf returns {\"series\":null} — never filter on it");
  assert.ok(t.apiQuery, `every topic must carry the official discovery query it is built from (${t.id})`);
}
const supTopics = Object.fromEntries(TOPICS.map((t) => [t.id, new Set()]));
supTopics.culture.add("KXTOPARTIST");            // an Entertainment series, listed in the superset
supTopics.culture.add("KXXBANNEDGROK");          // a real Culture series
const supEvents = [
  { event_ticker: "EC1", category: "Entertainment", series_ticker: "KXTOPARTIST", title: "Top artist" },
  { event_ticker: "EC2", category: "Culture", series_ticker: "KXXBANNEDGROK", title: "Grok banned" },
];
const supOut = classify(
  [{ ticker: "M1", event_ticker: "EC1" }, { ticker: "M2", event_ticker: "EC2" }], supEvents, supTopics);
assert.equal(supOut.length, 2, "both the category row and the superset row are kept");
assert.equal(supOut.find((r) => r.ticker === "M1")._viaSuperset, true, "the superset row says so");
assert.equal(supOut.find((r) => r.ticker === "M2")._viaSuperset, false, "the real Culture row is not marked");

// --- settlement-source links: only what the API publishes, placeholders dropped ---
const links = sourceLinks({
  settlement_sources: [
    { name: "AAA", url: "https://gasprices.aaa.com/" },
    { name: "duplicate", url: "https://gasprices.aaa.com/" },
    { name: "The Source Agencies are", url: "https://kalshi.com/" },   // placeholder, carries no source
    { name: "empty", url: "" },
    null,
  ],
});
assert.equal(links.length, 1, "one real source: deduped, blanks and kalshi.com placeholders dropped");
assert.equal(links[0].name, "AAA");
assert.deepEqual(sourceLinks({}), [], "no record, no links — never a guess");
assert.deepEqual(sourceLinks(null), [], "null record tolerated");

// --- threshold comparisons in tick space (regression: exactly $0.10) --------
// Float subtraction drifts: 0.42 - 0.32 = 0.09999999999999998, which a bare
// `>= 0.10` test silently loses. Every >= $0.10 decision runs on integer
// 1/10,000-dollar ticks (same rule as strategies.py `_ticks`).
assert.equal((0.42 - 0.32) !== 0.10, true, "sanity: floats really drift here");
assert.equal(ticks(0.42) - ticks(0.32), 1000, "exactly 10 cents is 1000 ticks");
assert.equal(movedTicks(0.32, 0.42), 1000);
assert.equal(movedTicks(0.42, 0.32), -1000, "direction preserved");
assert.equal(movedTicks(0.33, 0.42), 900, "9 cents stays 9 cents");
assert.equal(isSwing(0.32, 0.42), true, "an exactly-$0.10 rise must alert (portfolio.js momentum, dashboard)");
assert.equal(isSwing(0.42, 0.32), true, "an exactly-$0.10 fall must alert");
assert.equal(isSwing(0.33, 0.42), false, "a 9-cent move must not alert");
assert.equal(isSwing(0.32, 0.425), true, "moves above $0.10 alert too");
assert.equal(isSwing(null, 0.42), false, "missing price never alerts");
assert.equal(ticks("0.4200"), 4200, "fixed-point strings accepted");
assert.equal(ticks(null), null);

console.log("logic tests passed");
