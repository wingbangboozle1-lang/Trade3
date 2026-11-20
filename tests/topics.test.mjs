// Topic classification: the requirement is that ONLY gas prices, elections,
// culture, crypto and golf get through, and that every placement is explainable.

import { suite, test, assert, eq } from './harness.mjs';
import { TopicClassifier } from '../app/lib/topics.mjs';
import { config } from '../app/config.mjs';

const c = new TopicClassifier(config.topics);

suite('topics — only the five requested categories', () => {
  test('there are exactly five topics, named as requested', () => {
    eq(c.ids.length, 5);
    for (const id of ['gas', 'elections', 'culture', 'crypto', 'golf']) assert(c.ids.includes(id), id);
  });

  test('gas series classify by prefix', () => {
    const r = c.classify({ seriesTicker: 'KXAAAGASM-26NOV' });
    eq(r.id, 'gas');
    assert(r.reason.includes('KXAAAGASM'));
    eq(r.confidence, 'high');
  });

  test('crypto series classify by prefix, longest prefix wins', () => {
    eq(c.classify({ seriesTicker: 'KXBTCMAX150-26' }).id, 'crypto');
    eq(c.classify({ seriesTicker: 'KXETHY-26' }).id, 'crypto');
  });

  test('golf and culture and elections classify by prefix', () => {
    eq(c.classify({ seriesTicker: 'KXPGA-MASTERS26' }).id, 'golf');
    eq(c.classify({ seriesTicker: 'KXEMMYCSERIES-26' }).id, 'culture');
    eq(c.classify({ seriesTicker: 'KXELECTIRAN-26' }).id, 'elections');
  });

  test('titles classify when the ticker is unknown', () => {
    eq(c.classify({ seriesTicker: 'ZZZ', eventTitle: 'Will bitcoin hit $200k?' }).id, 'crypto');
    eq(c.classify({ seriesTicker: 'ZZZ', eventTitle: 'PGA Championship winner' }).id, 'golf');
    eq(c.classify({ seriesTicker: 'ZZZ', eventTitle: 'National average gas price' }).id, 'gas');
    eq(c.classify({ seriesTicker: 'ZZZ', eventTitle: 'Senate election winner' }).id, 'elections');
    eq(c.classify({ seriesTicker: 'ZZZ', eventTitle: 'Grammy album of the year' }).id, 'culture');
  });

  test('an unrelated market is NOT forced into a topic', () => {
    eq(c.classify({ seriesTicker: 'KXCPI-26', eventTitle: 'CPI year over year' }), null);
    eq(c.classify({ seriesTicker: 'KXNBA', eventTitle: 'NBA finals' }), null);
    eq(c.classify({}), null);
  });

  test('word boundaries stop false positives', () => {
    // "gas" inside "gasket" must not classify a market as gas prices
    eq(c.classify({ seriesTicker: 'ZZZ', eventTitle: 'Gasket manufacturing output' }), null);
  });

  test('categories classify at medium confidence', () => {
    const r = c.classify({ seriesTicker: 'ZZZ', eventTitle: 'Some title', categories: ['Crypto'] });
    eq(r.id, 'crypto');
    eq(r.confidence, 'medium');
  });

  test('every seed series in topics.json carries an official source id', () => {
    let seeds = 0;
    for (const [id, t] of Object.entries(config.topics.topics)) {
      for (const s of t.seed_series || []) {
        seeds += 1;
        assert(s.source_id, `${id}/${s.series_ticker} has no source_id`);
        assert(s.evidence && s.evidence.length > 10, `${id}/${s.series_ticker} has no evidence text`);
      }
    }
    assert(seeds >= 5, `only ${seeds} seeded series`);
  });

  test('every topic has news/cause feeds with https urls', () => {
    for (const [id, t] of Object.entries(config.topics.topics)) {
      assert(t.news_feeds?.length >= 1, `${id} has no feeds`);
      for (const f of t.news_feeds) assert(f.url.startsWith('https://'), `${id} feed ${f.url} is not https`);
    }
  });

  test('the alert threshold is set to the requested $0.10', () => {
    eq(config.topics.thresholds.alert_move_dollars, 0.1);
  });
});
