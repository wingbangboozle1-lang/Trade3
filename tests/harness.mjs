// Tiny zero-dependency test harness. Deliberately not a framework: the point is
// that anyone can run `npm test` on a bare Node install and see exactly what passed.

const results = [];
let currentSuite = '';

export function suite(name, fn) {
  currentSuite = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
  fn();
  currentSuite = '';
}

export function test(name, fn) {
  const started = Date.now();
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      throw new Error('async tests must use testAsync()');
    }
    results.push({ suite: currentSuite, name, ok: true });
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${Date.now() - started}ms)\x1b[0m`);
  } catch (err) {
    results.push({ suite: currentSuite, name, ok: false, error: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      \x1b[31m${err.message}\x1b[0m`);
  }
}

export async function testAsync(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ suite: currentSuite, name, ok: true });
    console.log(`  \x1b[32m✓\x1b[0m ${name} \x1b[90m(${Date.now() - started}ms)\x1b[0m`);
  } catch (err) {
    results.push({ suite: currentSuite, name, ok: false, error: err.message });
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      \x1b[31m${err.message}\x1b[0m`);
  }
}

export function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}

export function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'not equal'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function near(actual, expected, tol, message) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${message || 'not near'}: expected ${expected} ± ${tol}, got ${actual}`);
  }
}

export function summary() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${failed === 0 ? '\x1b[32m' : '\x1b[31m'}${passed} passed, ${failed} failed, ${results.length} total\x1b[0m`);
  if (failed) {
    console.log('\nFailures:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  - ${r.suite} :: ${r.name}\n    ${r.error}`);
  }
  return failed === 0;
}
