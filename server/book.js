/**
 * Order-book depth model shared by the dashboard's liquidity panel.
 *
 * Official basis (no invention):
 *   - GET /markets/{ticker}/orderbook returns "all active bid orders for both yes
 *     and no sides ... It returns yes bids and no bids only (no asks are returned).
 *     This is because in binary markets, a bid for yes at price X is equivalent to
 *     an ask for no at (1 - X)".
 *     https://docs.kalshi.com/api-reference/market/get-market-orderbook
 *   - GET /markets/{ticker}/orderbook rows are [price, count] with prices as
 *     fixed-point dollar strings under `orderbook_fp` (`yes_dollars`, `no_dollars`).
 *   - The `orderbook_delta` channel exists but is PRIVATE, so the keyless site
 *     cannot keep a live book over the socket; it refreshes snapshots over REST.
 *
 * Everything here is deterministic arithmetic on values Kalshi returned. When a
 * side is empty the answer is "no resting contracts", printed as an em dash, never
 * a made-up number.
 */

/** Normalise the several shapes Kalshi may return into [[priceDollars, contracts]]. */
export function normalizeLevels(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    if (Array.isArray(row)) {
      const price = Number.parseFloat(row[0]);
      const count = Number.parseFloat(row[1]);
      if (Number.isFinite(price) && Number.isFinite(count)) out.push([price, count]);
    } else if (row && typeof row === 'object') {
      const price = Number.parseFloat(row.price_dollars ?? row.price ?? row[0]);
      const count = Number.parseFloat(row.count_fp ?? row.count ?? row.quantity ?? row[1]);
      if (Number.isFinite(price) && Number.isFinite(count)) out.push([price, count]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Map the two documented sides into a YES-perspective ladder.
 * A NO bid at price p is a YES offer at 1 - p, which is why only bids exist.
 */
export class BookDepth {
  constructor({ side = 'yes' } = {}) {
    this.side = side;
  }
}

export class OrderBookState {
  constructor({ yes = [], no = [], ticker = null, at = Date.now(), source = 'rest' } = {}) {
    this.ticker = ticker;
    this.at = at;
    this.source = source;
    this.yes = new Map();
    this.no = new Map();
    for (const [p, c] of normalizeLevels(yes)) this.yes.set(p, c);
    for (const [p, c] of normalizeLevels(no)) this.no.set(p, c);
  }

  /** Best (highest) YES bid, or null when nothing rests. */
  get yesBid() {
    let best = null;
    for (const p of this.yes.keys()) if (best == null || p > best) best = p;
    return best;
  }

  /** Best NO bid, or null. */
  get noBid() {
    let best = null;
    for (const p of this.no.keys()) if (best == null || p > best) best = p;
    return best;
  }

  /**
   * YES ask implied by the best NO bid: 1 - noBid. This is the documented
   * equivalence, not an estimate. Null when the NO side is empty.
   */
  get yesAsk() {
    const nb = this.noBid;
    return nb == null ? null : Math.round((1 - nb) * 10000) / 10000;
  }

  /** Spread in 1/10000-dollar ticks: (yesAsk - yesBid). Null if either side is empty. */
  get spreadTicks() {
    const b = this.yesBid;
    const a = this.yesAsk;
    if (b == null || a == null) return null;
    return Math.round(a * 10000) - Math.round(b * 10000);
  }

  /** Dollar spread, or null. */
  get spread() {
    const t = this.spreadTicks;
    return t == null ? null : t / 10000;
  }

  /**
   * Ladder rows for one side, best price first.
   * `dollars` is contracts x price — the notional resting at that level.
   */
  levels({ side = 'yes' } = {}) {
    const book = side === 'yes' ? this.yes : this.no;
    return [...book.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([price, contracts]) => ({
        side,
        price,
        contracts,
        dollars: Math.round(contracts * price * 100) / 100,
      }));
  }

  /** Contracts and dollars resting within `bandDollars` of the best price on a side. */
  depthWithin(bandDollars, side = 'yes') {
    const rows = this.levels({ side });
    if (!rows.length) return { contracts: 0, dollars: 0 };
    const best = rows[0].price;
    // Integer-tick comparison so an exactly-$0.03 band is never lost to float noise.
    const bandTicks = Math.round(bandDollars * 10000);
    const bestTicks = Math.round(best * 10000);
    let contracts = 0;
    let dollars = 0;
    for (const row of rows) {
      if (bestTicks - Math.round(row.price * 10000) > bandTicks) break;
      contracts += row.contracts;
      dollars += row.dollars;
    }
    return { contracts, dollars: Math.round(dollars * 100) / 100 };
  }

  toJSON() {
    return {
      ticker: this.ticker,
      at: this.at,
      source: this.source,
      yesBid: this.yesBid,
      yesAsk: this.yesAsk,
      noBid: this.noBid,
      spread: this.spread,
      yes: this.levels({ side: 'yes' }),
      no: this.levels({ side: 'no' }),
    };
  }
}

/** Build a book from a REST orderbook payload ({ yes, no } or orderbook_fp). */
export function buildOrderbookState(raw, { ticker = null, at = Date.now(), source = 'rest' } = {}) {
  if (raw && raw.orderbook_fp) {
    return new OrderBookState({
      yes: raw.orderbook_fp.yes_dollars ?? raw.orderbook_fp.yes ?? [],
      no: raw.orderbook_fp.no_dollars ?? raw.orderbook_fp.no ?? [],
      ticker, at, source,
    });
  }
  return new OrderBookState({ yes: raw?.yes ?? [], no: raw?.no ?? [], ticker, at, source });
}

/**
 * Apply a snapshot or delta message to a book.
 *
 * `orderbook_delta` is documented as a private channel, so in practice this is
 * fed by the collector when it *is* authorised; the parsing rules are the
 * documented ones and are unit-tested either way:
 *   - orderbook_snapshot replaces both sides wholesale;
 *   - orderbook_delta adds `delta` contracts at `price` on `side`, and a level
 *     that reaches zero is removed rather than kept at 0.
 */
export function applyBookMessage(state, message) {
  const type = message?.type;
  const msg = message?.msg || {};
  const ticker = msg.market_ticker || state.ticker;

  if (type === 'orderbook_snapshot') {
    return new OrderBookState({
      yes: msg.yes ?? msg.yes_dollars ?? [],
      no: msg.no ?? msg.no_dollars ?? [],
      ticker,
      at: Date.now(),
      source: 'ws',
    });
  }

  if (type !== 'orderbook_delta') return state;

  const next = new OrderBookState({ ticker, at: Date.now(), source: 'ws' });
  next.yes = new Map(state.yes);
  next.no = new Map(state.no);
  const side = msg.side === 'no' ? next.no : next.yes;
  const price = Number.parseFloat(msg.price_dollars ?? msg.price);
  const delta = Number.parseFloat(msg.delta ?? msg.delta_fp ?? 0);
  if (!Number.isFinite(price) || !Number.isFinite(delta)) return state;

  // Re-key on the parsed float so "0.50" and 0.5 address the same level.
  const existingKey = [...side.keys()].find((k) => Math.round(k * 10000) === Math.round(price * 10000));
  const current = existingKey == null ? 0 : side.get(existingKey);
  if (existingKey != null) side.delete(existingKey);
  const updated = current + delta;
  if (updated > 0) side.set(existingKey ?? price, updated);
  return next;
}
