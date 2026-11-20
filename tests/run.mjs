// Runner: imports every test file, then prints a summary and sets the exit code.
import './fees.test.mjs';
import './signing.test.mjs';
import './alerts.test.mjs';
import './paper.test.mjs';
import './strategy.test.mjs';
import './topics.test.mjs';
import './mock-exchange.test.mjs';
import './ingest.test.mjs';
import './analytics.test.mjs';
import './site.test.mjs';
import { summary } from './harness.mjs';

process.exit(summary() ? 0 : 1);
