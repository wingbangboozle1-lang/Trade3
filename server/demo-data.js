/**
 * Demo (synthetic) data generator.
 *
 * WHY THIS EXISTS
 * The build sandbox cannot reach Kalshi's hosts, so a live preview of the UI would
 * otherwise be empty and impossible to evaluate. This module generates *clearly
 * fictional* markets and prices so the dashboard's behaviour can be seen and tested.
 *
 * HARD RULES
 *  - It never claims to be live. The collector reports dataMode = 'demo'.
 *  - Tickers are prefixed DEMO- and titles start with "[DEMO]", so a synthetic row
 *    can never be mistaken for a real Kalshi market.
 *  - Every generated market looks like a real GET /markets object, so the same code
 *    path runs in all three modes.
 *
 * Enable with DATA_MODE=demo (or automatically after repeated live failures when
 * DATA_MODE is unset and ALLOW_DEMO_FALLBACK is not "0").
 */

const T0 = Date.now();

function iso(ms) {
  return new Date(ms).toISOString();
}

/** A slow, deterministic random walk so two runs look similar but not identical. */
function walker(seed, step = 0.01) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return ((s / 2147483648) * 2 - 1) * step;
  };
}

const SEEDS = [
  // ---- gas ----
  { series: 'KXAAAGASM', ticker: 'DEMO-KXAAAGASM-26NOV30-4.20', title: '[DEMO] Will average gas prices be above $4.20?', sub: 'Above 4.20', price: 0.46, vol: 412000, oi: 62000 },
  { series: 'KXAAAGASM', ticker: 'DEMO-KXAAAGASM-26NOV30-4.40', title: '[DEMO] Will average gas prices be above $4.40?', sub: 'Above 4.40', price: 0.23, vol: 180000, oi: 41000 },
  // ---- elections ----
  { series: 'KXNEXTNATOSECGEN', ticker: 'DEMO-KXNEXTNATOSECGEN-99-MFRE', title: '[DEMO] Will Mette Frederiksen be the next Secretary General of NATO?', sub: 'Mette Frederiksen', price: 0.51, vol: 96000, oi: 24000 },
  { series: 'KXCA4PRIMARY', ticker: 'DEMO-KXCA4PRIMARY-ADV', title: '[DEMO] Who will advance from California\u2019s top-two primary for CA-4?', sub: 'Advance', price: 0.64, vol: 152000, oi: 38000 },
  // ---- culture ----
  { series: 'KXXBANNEDGROK', ticker: 'DEMO-KXXBANNEDGROK-27', title: '[DEMO] Will Grok be banned this year?', sub: 'Banned', price: 0.37, vol: 74000, oi: 19000 },
  { series: 'KXOSCAR', ticker: 'DEMO-KXOSCAR-27-BESTPIC', title: '[DEMO] Will this film win Best Picture at the Oscars?', sub: 'Best Picture', price: 0.29, vol: 131000, oi: 33000 },
  // ---- crypto ----
  { series: 'KXBTCD', ticker: 'DEMO-KXBTCD-26NOV2101-T70800', title: '[DEMO] Bitcoin price on Nov 21, 2026?', sub: '$70,800 or above', price: 0.48, vol: 812000, oi: 96000 },
  { series: 'KXETHD', ticker: 'DEMO-KXETHD-26NOV2117-T2460', title: '[DEMO] Ethereum price at Nov 21, 2026 at 5pm EST?', sub: '$2,460 or above', price: 0.41, vol: 355000, oi: 54000 },
  // ---- golf ----
  { series: 'KXPGATOUR', ticker: 'DEMO-KXPGATOUR-THRC26-BHAA', title: '[DEMO] The RSM Classic: Bill Haas wins', sub: 'Bill Haas', price: 0.06, vol: 28000, oi: 7000 },
  { series: 'KXPGATOUR', ticker: 'DEMO-KXPGATOUR-THRC26-RSTR', title: '[DEMO] The RSM Classic: Robert Streb wins', sub: 'Robert Streb', price: 0.12, vol: 34000, oi: 9000 },
];

const WALKERS = new Map(SEEDS.map((s, i) => [s.ticker, walker(i * 7919 + 13, 0.012)]));

/**
 * Build GET /markets-shaped objects whose prices drift on every call, so swings of
 * $0.10 or more genuinely happen and the whole alert pipeline is exercised.
 */
export function syntheticMarkets({ closeWindowHours = 72 } = {}) {
  return SEEDS.map((seed) => {
    const step = WALKERS.get(seed.ticker)();
    // Occasionally take a bigger jump so the $0.10 alert threshold is reliably hit.
    const spike = Math.random() < 0.22 ? (Math.random() < 0.5 ? 1 : -1) * (0.1 + Math.random() * 0.09) : 0;
    const clamped = Math.min(0.97, Math.max(0.02, seed.price + step + spike));
    seed.price = clamped;
    const prev = Math.min(0.97, Math.max(0.02, clamped - (Math.random() - 0.5) * 0.08));
    const bid = Math.max(0.01, Math.round((clamped - 0.01) * 100) / 100);
    const ask = Math.min(0.99, Math.round((clamped + 0.01) * 100) / 100);
    return {
      ticker: seed.ticker,
      event_ticker: `${seed.series}-DEMOEVENT`,
      title: seed.title,
      yes_sub_title: seed.sub,
      no_sub_title: seed.sub,
      market_type: 'binary',
      status: 'active',
      result: '',
      close_time: iso(T0 + closeWindowHours * 3600 * 1000),
      open_time: iso(T0 - 24 * 3600 * 1000),
      expected_expiration_time: iso(T0 + closeWindowHours * 3600 * 1000),
      last_price_dollars: clamped.toFixed(4),
      previous_price_dollars: prev.toFixed(4),
      yes_bid_dollars: bid.toFixed(4),
      yes_ask_dollars: ask.toFixed(4),
      yes_bid_size_fp: (150 + Math.round(Math.random() * 400)).toFixed(2),
      yes_ask_size_fp: (150 + Math.round(Math.random() * 400)).toFixed(2),
      no_bid_dollars: (1 - ask).toFixed(4),
      no_ask_dollars: (1 - bid).toFixed(4),
      volume_fp: seed.vol.toFixed(2),
      volume_24h_fp: (seed.vol * (0.2 + Math.random() * 0.4)).toFixed(2),
      open_interest_fp: (seed.oi * (0.8 + Math.random() * 0.4)).toFixed(2),
      notional_value_dollars: '1.0000',
      price_level_structure: 'linear_cent',
      price_ranges: [{ start: '0.0000', end: '1.0000', step: '0.0100' }],
      settlement_bounds_type: 'default',
      settlement_timer_seconds: 60,
      can_close_early: true,
      expiration_value: '',
      rules_primary: '[DEMO DATA] Synthetic market generated locally for UI demonstration. Not a real Kalshi market.',
      rules_secondary: '',
    };
  });
}

/** Series metadata for the synthetic series, shaped like GET /series responses. */
export const SYNTHETIC_SERIES = {
  KXAAAGASM: { category: 'Economics', tags: ['Oil & Gas', 'Oil and energy'], scope: 'Gasoline', title: 'US gas price (demo)' },
  KXNEXTNATOSECGEN: { category: 'Elections', tags: [], scope: null, title: 'Next NATO Secretary General (demo)' },
  KXCA4PRIMARY: { category: 'Elections', tags: ['Primaries', 'US Elections'], scope: null, title: 'CA-4 primary (demo)' },
  KXXBANNEDGROK: { category: 'Culture', tags: ['AI'], scope: null, title: 'Will Grok be banned (demo)' },
  KXOSCAR: { category: 'Culture', tags: [], scope: null, title: 'Oscars (demo)' },
  KXBTCD: { category: 'Crypto', tags: ['Crypto', 'Hourly', 'Bitcoin'], scope: null, title: 'Bitcoin price Above/below (demo)' },
  KXETHD: { category: 'Crypto', tags: ['Crypto', 'Hourly', 'Ethereum'], scope: null, title: 'Ethereum price Above/below (demo)' },
  KXPGATOUR: { category: 'Sports', tags: ['Golf'], scope: 'Game', title: 'PGA Tour (demo)' },
};

/** A plausible order book around a mid price, derived from the market's own bid/ask. */
export function syntheticBook(market) {
  const mid = Number(market.last_price_dollars);
  const yes = [];
  const no = [];
  for (let i = 0; i < 6; i += 1) {
    const yp = Math.max(0.01, Math.round((mid - 0.01 - i * 0.02) * 100) / 100);
    if (yp > 0.001) yes.push({ price: yp, count: Math.round(80 + Math.random() * 900) });
    const np = Math.max(0.01, Math.round((1 - mid - 0.01 - i * 0.02) * 100) / 100);
    if (np > 0.001) no.push({ price: np, count: Math.round(80 + Math.random() * 900) });
  }
  return { yes: yes.reverse(), no: no.reverse() };
}

export const DEMO_MODE_NOTICE =
  'Synthetic demo data: prices are generated locally and are NOT Kalshi markets. Used only because the Kalshi API was unreachable from this host.';
