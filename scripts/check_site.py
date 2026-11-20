#!/usr/bin/env python3
"""Static-site checks for the Trade3 GitHub Pages build.

Fails (exit 1) on anything that would ship a broken page:
  * missing local links, images, scripts or stylesheets
  * missing anchors referenced by an in-page link
  * HTML that never closes <html> or references a file outside docs/
  * JS modules that do not parse as ES modules (optional: needs node)
  * data/series.json rows missing a source URL or a required field

Run from the repo root:  python scripts/check_site.py
"""
from __future__ import annotations

import html.parser
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

DOCS = Path("docs")
ROOT = Path(__file__).resolve().parents[1]

errors: list[str] = []
warnings: list[str] = []
checked_links = 0


class Collector(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []   # (kind, href)
        self.ids: set[str] = set()
        self.scripts: list[str] = []
        self.styles: list[str] = []
        self.closes_html = False
        self.has_title = False
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.add(a["id"])
        if tag == "a" and a.get("href"):
            self.links.append(("href", a["href"]))
        elif tag in ("img", "script", "link", "source") and (a.get("src") or a.get("href")):
            target = a.get("src") or a.get("href")
            self.links.append((tag, target))
            if tag == "script":
                self.scripts.append(target)
            if tag == "link" and "stylesheet" in (a.get("rel") or ""):
                self.styles.append(target)
        elif tag == "title":
            self.has_title = True
        if tag == "/html":
            self.closes_html = True

    def handle_endtag(self, tag):
        if tag == "html":
            self.closes_html = True


def check_pages() -> None:
    pages = sorted(DOCS.rglob("*.html"))
    if not pages:
        errors.append("no HTML pages found under docs/")
        return
    parsed: dict[Path, Collector] = {}
    for page in pages:
        text = page.read_text(encoding="utf-8")
        if "<!DOCTYPE html>" not in text[:200]:
            warnings.append(f"{page}: missing <!DOCTYPE html>")
        p = Collector()
        try:
            p.feed(text)
        except Exception as exc:                       # noqa: BLE001
            errors.append(f"{page}: unparsable HTML ({exc})")
            continue
        parsed[page] = p
        if not p.closes_html:
            errors.append(f"{page}: </html> never closed")
        if not p.has_title:
            warnings.append(f"{page}: no <title>")

    for page, p in parsed.items():
        for kind, target in p.links:
            if not target or target.startswith(("http://", "https://", "mailto:", "data:", "#", "javascript:")):
                if target.startswith("#") and len(target) > 1:
                    if target[1:] not in p.ids:
                        errors.append(f"{page}: in-page anchor '{target}' has no matching id")
                continue
            global checked_links
            checked_links += 1
            path_part = unquote(urlparse(target).path)
            if not path_part:
                continue
            dest = (page.parent / path_part).resolve()
            if not str(dest).startswith(str((ROOT / DOCS).resolve())):
                errors.append(f"{page}: link escapes docs/: {target}")
                continue
            if not dest.exists():
                errors.append(f"{page}: broken {kind} link -> {target}")
    print(f"checked {len(pages)} pages and {checked_links} local links")


def check_js() -> None:
    node = shutil.which("node")
    files = sorted(DOCS.rglob("*.js"))
    if not files:
        warnings.append("no JavaScript files found")
        return
    if not node:
        warnings.append(f"node not found — skipped syntax check of {len(files)} JS files")
        return
    for f in files:
        r = subprocess.run([node, "--input-type=module", "--check"], input=f.read_bytes(),
                           capture_output=True)
        if r.returncode != 0:
            errors.append(f"{f}: JS syntax error: {r.stderr.decode()[:300]}")
    print(f"parsed {len(files)} JS modules with node")


def check_data() -> None:
    data_file = DOCS / "data" / "series.json"
    if not data_file.exists():
        errors.append("docs/data/series.json is missing")
        return
    try:
        data = json.loads(data_file.read_text())
    except json.JSONDecodeError as exc:
        errors.append(f"series.json is not valid JSON: {exc}")
        return
    required = {"ticker", "title", "frequency", "category", "settlement", "source"}
    total = 0
    for topic_id, topic in data.get("topics", {}).items():
        for key in ("label", "kalshi_category", "series"):
            if key not in topic:
                errors.append(f"series.json topic '{topic_id}' lacks '{key}'")
        for row in topic.get("series", []):
            total += 1
            missing = required - set(row)
            if missing:
                errors.append(f"series.json {topic_id}/{row.get('ticker','?')}: missing {sorted(missing)}")
            src = row.get("source", "")
            if not src.startswith("https://external-api."):
                errors.append(f"series.json {row.get('ticker','?')}: source must be an official API URL, got {src!r}")
            if row.get("category") != topic.get("kalshi_category"):
                errors.append(f"series.json {row.get('ticker','?')}: category {row.get('category')!r} "
                              f"!= topic category {topic.get('kalshi_category')!r}")
    print(f"checked {total} series rows in series.json")


def check_no_localhost() -> None:
    """The Pages site is served over HTTPS; browser calls to localhost would break previews."""
    pat = re.compile(r"https?://(localhost|127\.0\.0\.1)")
    for f in list(DOCS.rglob("*.js")) + list(DOCS.rglob("*.html")):
        if pat.search(f.read_text(encoding="utf-8", errors="ignore")):
            errors.append(f"{f}: references localhost/127.0.0.1 — breaks in the browser sandbox")


def main() -> int:
    if not DOCS.exists():
        print("docs/ not found — run from the repository root")
        return 2
    check_pages()
    check_js()
    check_data()
    check_no_localhost()
    for w in warnings:
        print(f"WARN {w}")
    for e in errors:
        print(f"FAIL {e}")
    if errors:
        print(f"\n{len(errors)} problem(s) found")
        return 1
    print("\nall site checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
