// Fixed-point + money helpers.
//
// Kalshi represents money and contract counts as *strings*, not floats:
//   prices  -> FixedPointDollars, e.g. "0.5600"   (up to 6 decimals in responses)
//   counts  -> FixedPointCount,   e.g. "10.00"    (always 2 decimals in responses)
// Docs: https://docs.kalshi.com/getting_started/fixed_point_migration.md (K23)
//       https://docs.kalshi.com/api-reference/market/get-markets.md      (K9)
//
// We keep integer "ticks" (1e-6 of a dollar) internally for exact comparisons and
// only format at the edges. Never compare two price strings with < or >.

export const TICKS_PER_DOLLAR = 1_000_000;

/** Parse a Kalshi fixed-point dollar string (or number) into integer ticks. */
export function dollarsToTicks(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = typeof value === 'string' ? value.trim() : String(value);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [whole, frac = ''] = body.split('.');
  const fracTicks = Number((frac + '000000').slice(0, 6));
  const ticks = Number(whole) * TICKS_PER_DOLLAR + fracTicks;
  return neg ? -ticks : ticks;
}

/** Parse a fixed-point count string ("10.00") or number into hundredths. */
export function countToCents100(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = typeof value === 'string' ? value.trim() : String(value);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Ticks -> "$0.5600" style string used for display and for API request bodies. */
export function ticksToDollars(ticks, decimals = 4) {
  if (ticks === null || ticks === undefined) return '';
  const sign = ticks < 0 ? '-' : '';
  const abs = Math.abs(ticks);
  const whole = Math.floor(abs / TICKS_PER_DOLLAR);
  const frac = String(abs % TICKS_PER_DOLLAR).padStart(6, '0').slice(0, decimals);
  return `${sign}${whole}.${frac}`;
}

/** Short display form: 0.56, 0.5, 0.07 (no trailing zeros, at least 2 dp). */
export function fmtPrice(ticks) {
  if (ticks === null || ticks === undefined) return '—';
  const d = ticksToDollars(ticks, 6);
  const trimmed = d.replace(/0+$/, '').replace(/\.$/, '');
  const [w, f = ''] = trimmed.split('.');
  return `${w}.${(f + '00').slice(0, Math.max(2, f.length))}`;
}

/** Money display with thousands separators and 2 dp. */
export function fmtMoney(ticks) {
  if (ticks === null || ticks === undefined) return '—';
  const v = ticks / TICKS_PER_DOLLAR;
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Round *up* to a step, in tick space. Used by the fee formula ("round up"). */
export function ceilToStep(value, step) {
  if (!Number.isFinite(value)) return 0;
  // Kill binary-float dust before the ceil so 1.75 does not become 1.7501.
  const eps = step * 1e-9;
  return Math.ceil((value - eps) / step) * step;
}

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

export function nowMs() {
  return Date.now();
}

/** Unix seconds -> ISO string, or '—'. */
export function isoFromSec(sec) {
  if (!sec) return '—';
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Date(n * 1000).toISOString().replace('.000Z', 'Z');
}

export function isoFromMs(ms) {
  if (!ms) return '—';
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return new Date(n).toISOString().replace('.000Z', 'Z');
}

/** Human "in 3h 12m" / "closed" for a close time. */
export function timeToCloseLabel(closeSec, atMs = Date.now()) {
  if (!closeSec) return '—';
  const diff = Number(closeSec) * 1000 - atMs;
  if (diff <= 0) return 'closed';
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Monotonic-ish id that sorts by time; safe across restarts. */
let counter = 0;
export function nextId(prefix = '') {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}`;
}

/**
 * Deterministic PRNG (mulberry32). Used by the mock exchange so that a replay of
 * the same seed produces the same market path — tests depend on it.
 */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rolling window helper used by the alert engine and the chart ranges. */
export const WINDOWS = [
  { id: '1s', ms: 1_000 },
  { id: '10s', ms: 10_000 },
  { id: '1m', ms: 60_000 },
  { id: '5m', ms: 300_000 },
  { id: '1h', ms: 3_600_000 },
  { id: '6h', ms: 21_600_000 },
  { id: '1d', ms: 86_400_000 }
];
