/**
 * Injects the shared header and footer so every page has identical navigation and
 * source disclaimers. Keeps nav edits in one place (single source of truth).
 */
(function () {
  const NAV = [
    ['index.html', 'Overview'],
    ['markets.html', 'Markets'],
    ['topics.html', 'Topics'],
    ['resolutions.html', 'Resolutions'],
    ['strategies.html', 'Strategies'],
    ['recommendations.html', 'Recommendations'],
    ['executive-summary.html', 'Executive Summary'],
    ['requirements.html', 'Requirements'],
    ['flagged.html', 'Flagged for Review'],
    ['sources.html', 'Sources'],
  ];

  function header() {
    const el = document.createElement('header');
    el.className = 'site';
    el.innerHTML = `
      <div class="header-inner">
        <div class="brand">
          <span class="mark" aria-hidden="true">K</span>
          <a href="index.html">Kalshi Demo Dashboard</a>
        </div>
        <nav class="main" aria-label="Main">
          ${NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}
        </nav>
      </div>`;
    return el;
  }

  function footer() {
    const el = document.createElement('footer');
    el.className = 'site';
    el.innerHTML = `
      <div class="inner">
        <div>
          <h4>What this is</h4>
          <p class="muted" style="margin:0">
            A source-audited dashboard and findings site for the Kalshi <strong>demo</strong> environment.
            Every value links to the official Kalshi endpoint it came from. Anything the API did not
            return is left blank and marked unverified.
          </p>
        </div>
        <div>
          <h4>Official Kalshi references</h4>
          <ul>
            <li><a href="https://docs.kalshi.com/getting_started/demo_env" target="_blank" rel="noopener">Demo environment</a></li>
            <li><a href="https://docs.kalshi.com/getting_started/api_environments" target="_blank" rel="noopener">API environments &amp; endpoints</a></li>
            <li><a href="https://docs.kalshi.com/getting_started/orderbook_responses" target="_blank" rel="noopener">Orderbook responses</a></li>
            <li><a href="https://docs.kalshi.com/api-reference/market/get-markets" target="_blank" rel="noopener">Get Markets</a></li>
            <li><a href="https://kalshi.com/docs/kalshi-fee-schedule.pdf" target="_blank" rel="noopener">Fee schedule (PDF)</a></li>
          </ul>
        </div>
        <div>
          <h4>Data honesty</h4>
          <ul>
            <li>Demo prices are <strong>not</strong> production prices.</li>
            <li>No value is inferred or filled in.</li>
            <li><a href="flagged.html">Flagged for Review</a> lists every open question.</li>
            <li><a href="sources.html">Sources</a> lists every URL used.</li>
          </ul>
        </div>
        <div>
          <h4>Run it live</h4>
          <ul>
            <li><a href="executive-summary.html#run">How to run the live app</a></li>
            <li><a href="requirements.html">Requirements traceability</a></li>
            <li><a href="https://github.com/wingbangboozle1-lang/Trade3" target="_blank" rel="noopener">Repository on GitHub</a></li>
          </ul>
        </div>
      </div>`;
    return el;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const main = document.querySelector('main');
    if (main) {
      document.body.insertBefore(header(), main);
      document.body.appendChild(footer());
    }
    const here = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('nav.main a').forEach((a) => {
      if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
    });
  });
})();
