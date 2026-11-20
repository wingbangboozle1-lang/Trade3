/**
 * Deterministic market fixtures shaped exactly like GET /markets responses, so tests
 * never depend on the network and never invent field names.
 * Field names here come from the Get Markets OpenAPI schema.
 */

const iso = (ms) => new Date(ms).toISOString();

export function buildSeriesMarkets() {
  const now = Date.now();
  const rows = [
    // gas
    { ticker: 'KXGASPRICE-26NOV30-4.00', event_ticker: 'KXGASPRICE-26NOV30', title: 'Will the national average gas price be above $4.00 on Nov 30?', yes_sub_title: '$4.00', last_price: '0.42', prev: '0.28', vol: '18400' },
    // elections
    { ticker: 'KXSENATE-26GA-OSSOFF', event_ticker: 'KXSENATE-26GA', title: 'Will the Democrat win the Georgia Senate election in 2026?', yes_sub_title: 'Democrat', last_price: '0.58', prev: '0.51', vol: '92100' },
    // culture
    { ticker: 'KXOSCAR-27-BESTPIC', event_ticker: 'KXOSCAR-27', title: 'Will this film win Best Picture at the Oscars?', yes_sub_title: 'Yes', last_price: '0.31', prev: '0.44', vol: '7600' },
    // crypto
    { ticker: 'KXBTCD-26NOV20-T100000', event_ticker: 'KXBTCD-26NOV20', title: 'Will Bitcoin be above $100,000 at 5pm on Nov 20?', yes_sub_title: '$100,000', last_price: '0.66', prev: '0.52', vol: '502000' },
    { ticker: 'KXETHD-26NOV20-T3400', event_ticker: 'KXETHD-26NOV20', title: 'Will Ethereum be above $3,400 at 5pm on Nov 20?', yes_sub_title: '$3,400', last_price: '0.23', prev: '0.35', vol: '88000' },
    // golf
    { ticker: 'KXPGATOUR-27MASTERS-SCHEFFLER', event_ticker: 'KXPGATOUR-27MASTERS', title: 'Will Scottie Scheffler win the Masters golf tournament?', yes_sub_title: 'Scheffler', last_price: '0.19', prev: '0.12', vol: '4300' },
    // out of scope: weather
    { ticker: 'KXHIGHNY-26NOV20-T55', event_ticker: 'KXHIGHNY-26NOV20', title: 'Will the highest temperature in NYC be above 55 degrees?', yes_sub_title: '55°', last_price: '0.5', prev: '0.5', vol: '99999' },
  ];

  return rows.map((r) => ({
    ticker: r.ticker,
    event_ticker: r.event_ticker,
    title: r.title,
    yes_sub_title: r.yes_sub_title,
    no_sub_title: r.yes_sub_title,
    market_type: 'binary',
    status: 'active',
    result: '',
    close_time: iso(now + 36 * 3600 * 1000),
    open_time: iso(now - 48 * 3600 * 1000),
    expected_expiration_time: iso(now + 36 * 3600 * 1000),
    last_price_dollars: r.last_price,
    previous_price_dollars: r.prev,
    yes_bid_dollars: r.last_price,
    yes_ask_dollars: r.last_price,
    yes_bid_size_fp: '100.00',
    yes_ask_size_fp: '100.00',
    no_bid_dollars: String((1 - Number(r.last_price)).toFixed(4)),
    no_ask_dollars: String((1 - Number(r.last_price)).toFixed(4)),
    previous_yes_bid_dollars: r.prev,
    previous_yes_ask_dollars: r.prev,
    volume_fp: r.vol,
    volume_24h_fp: r.vol,
    open_interest_fp: String(Math.round(Number(r.vol) / 40)),
    notional_value_dollars: '1.0000',
    price_level_structure: 'linear_cent',
    price_ranges: [{ start: '0.0000', end: '1.0000', step: '0.0100' }],
    settlement_bounds_type: 'default',
    settlement_timer_seconds: 1800,
    can_close_early: false,
    expiration_value: '',
    rules_primary: 'Fixture rules for offline testing only.',
    rules_secondary: '',
  }));
}
