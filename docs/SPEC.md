# camoufox-pi — Design Spec

Status: draft, not yet implemented.
Last updated: 2026-04-12.

## 1. Purpose & Scope

A PI extension that performs **web search** and **URL fetching** through a Camoufox-driven Firefox instance, targeting sites that block or challenge conventional headless browsers.

**In scope**
- Search via multiple engines (Google, DuckDuckGo, Brave, Bing) with stealth fingerprinting.
- Fetch arbitrary URLs, return markdown or structured content.
- Long-lived browser process per PI session (not per tool call).
- Automatic, lazy Camoufox binary download on first use.
- Programmatic client API for non-PI consumers (TFF daemon, scripts, tests).

**Out of scope**
- Replacing lightpanda-pi for cooperative targets. Users pick one or the other based on target profile.
- TLS/JA3 fingerprint spoofing. Camoufox inherits Firefox's TLS ClientHello. Targets that fingerprint TLS need a `curl-impersonate` proxy — explicit non-goal for v1.
- CAPTCHA solving. If a target returns an unsolvable challenge, return a structured `captcha_required` error; the caller decides whether to integrate a CAPTCHA service.
- Managed cookie/account state (logins). v1 is stateless per session; cookie import may land in v2.

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  PI session                                                  │
│                                                              │
│  ┌─────────────────┐   ┌────────────────┐                    │
│  │ tff-search_web  │   │ tff-fetch_url  │   (PI tools)       │
│  └────────┬────────┘   └────────┬───────┘                    │
│           │                     │                            │
│           └──────────┬──────────┘                            │
│                      ▼                                       │
│              ┌───────────────┐                               │
│              │ CamoufoxClient│   (programmatic API)          │
│              │  (singleton)  │                               │
│              └───────┬───────┘                               │
│                      │                                       │
│                      ▼                                       │
│         ┌──────────────────────────┐                         │
│         │ camoufox-js + playwright │                         │
│         │        -core             │                         │
│         └──────────┬───────────────┘                         │
│                    │ Juggler (Firefox remote protocol)       │
│                    ▼                                         │
│         ┌──────────────────────────┐                         │
│         │ Camoufox browser process │                         │
│         └──────────────────────────┘                         │
└──────────────────────────────────────────────────────────────┘
```

**Key decisions**

- **Node-only runtime.** Use [`camoufox-js`](https://www.npmjs.com/package/camoufox-js) (Apify, MPL-2.0) + `playwright-core`. No Python dependency. Camoufox is a Firefox build; Playwright drives it via Juggler.
- **Singleton browser per session.** Boot once on first tool use (lazy), reuse across all search/fetch calls, kill on PI `session_end`. Avoids 1–3 s cold-start per call.
- **One context, multiple pages.** Use a single `BrowserContext` so cookies/cache accumulate across calls (useful for multi-step research). Open a fresh `Page` per request; close it after. Optional `isolate: true` param for one-off calls that must not pollute the shared context.
- **Lazy binary download.** On first `client.ensureReady()`, run the equivalent of `npx camoufox-js fetch` if the binary isn't cached. Emit progress events on the PI event bus so the host can show a spinner.
- **Auto-reconnect.** If the browser process dies mid-session, `CamoufoxClient` detects disconnection on the next call and transparently relaunches before retrying once.

## 3. PI Tool Surface

### 3.1 `tff-search_web`

```typescript
tff-search_web({
  query: string,
  engine?: "google" | "duckduckgo" | "brave" | "bing",  // default: "google"
  format?: "markdown" | "structured",                    // default: "markdown"
  max_results?: number,                                  // 1–50, default 10, clamped
  extract_selector?: string,                             // optional CSS selector to scope extraction
  timeout_ms?: number,                                   // per-call override
})
```

Stealth unlocks Google as the default — Lightpanda is stuck on DuckDuckGo Lite because Google blocks it.

**Output (structured format)**

```typescript
{
  results: Array<{ title: string; url: string; snippet: string; rank: number }>,
  bibliography_markdown: string,          // pre-formatted for RESEARCH.md paste
  engine: string,
  query: string,
  truncated: boolean,
  cached: boolean,
  timing: { total_ms: number; nav_ms: number; parse_ms: number },
}
```

### 3.2 `tff-fetch_url`

```typescript
tff-fetch_url({
  url: string,
  format?: "markdown" | "html" | "text",
  selector?: string,                          // return only this subtree
  screenshot?: boolean,                       // return PNG path alongside content
  render_mode?: "static" | "js",              // js = wait for document.readyState === "complete"
  wait_for_selector?: string,                 // wait for this selector before extracting
  timeout_ms?: number,
  isolate?: boolean,                          // use fresh context, no cookie reuse
})
```

### 3.3 Slash commands

- `/toggle-camoufox-search` — toggle whether camoufox-pi is the active search provider. Must actually wire into PI's search-provider selection (lightpanda-pi's equivalent toggle currently doesn't — see lightpanda-pi `src/index.ts:243`; don't replicate that bug).

## 4. Programmatic API

```typescript
export async function createClient(opts?: CamoufoxClientOptions): Promise<CamoufoxClient>;

export class CamoufoxClient {
  search(query: string, opts?: SearchOptions): Promise<SearchResult>;
  searchBatch(queries: string[], opts?: SearchOptions): Promise<SearchResult[]>;  // parallel
  fetchUrl(url: string, opts?: FetchOptions): Promise<FetchResult>;
  fetchUrlBatch(urls: string[], opts?: FetchOptions): Promise<FetchResult[]>;     // parallel
  screenshot(url: string, opts?: ScreenshotOptions): Promise<{ pngPath: string }>;
  checkHealth(): Promise<HealthStatus>;
  isAlive(): boolean;
  getMetrics(): Metrics;
  close(): Promise<void>;
  readonly events: EventEmitter;  // "search", "fetch_url", "error", "binary_download_progress"
}
```

PI tools are thin wrappers over this class. Non-PI consumers (TFF daemon, CI scripts, test harnesses) import directly.

## 5. Error Model

Discriminated union. Callers pattern-match; no string parsing.

```typescript
export type CamoufoxError =
  | { type: "binary_missing"; hint: string }
  | { type: "binary_download_failed"; cause: string; bytesDownloaded?: number }
  | { type: "binary_version_mismatch"; found: string; required: string }
  | { type: "browser_launch_failed"; stderr: string }
  | { type: "browser_crashed"; pid: number; signal?: string }
  | { type: "playwright_disconnected" }
  | { type: "timeout"; phase: "nav" | "wait_selector" | "extract"; elapsedMs: number }
  | { type: "network"; cause: string; url: string }
  | { type: "http"; status: number; url: string }
  | { type: "blocked"; reason: "cloudflare" | "datadome" | "perimeterx" | "generic_403" | "unknown"; url: string }
  | { type: "captcha_required"; provider: "turnstile" | "recaptcha" | "hcaptcha" | "unknown"; url: string }
  | { type: "selector_not_found"; selector: string }
  | { type: "parse_fail"; stage: string; raw: string }
  | { type: "config_invalid"; field: string; reason: string };
```

Blocked-detection heuristics: inspect response status, response URL, title ("Just a moment..."), known challenge markers (`cf-chl-bypass`, `datadome` cookies).

## 6. Retry Policy

| Error type | Retry? | Backoff |
|---|---|---|
| `network`, `timeout`, `playwright_disconnected`, `browser_crashed` | yes, up to 2 retries | 500 ms, 1500 ms |
| `http` 5xx | yes, up to 1 retry | 1000 ms |
| `http` 4xx, `blocked`, `captcha_required`, `binary_missing`, `config_invalid`, `selector_not_found` | no | — |
| `parse_fail` | no (deterministic) | — |

Retries are capped; no infinite loops. Per-call `max_retries` override supported.

## 7. Caching

- **In-memory LRU.** Default cap 100 entries, 10 min TTL. Key: SHA256 of `(engine, query, format, max_results, selector)` for search; `(url, format, selector)` for fetch. Opt-out via `cache: false`.
- **Optional on-disk cache** at `~/.cache/camoufox-pi/`. Opt-in via config. Useful for dev loops and CI. Separate TTL (default 1 h).
- **Request coalescing.** If an identical request is in flight, return the same promise — don't open two pages for one query.

## 8. Configuration

Resolution order (first wins):

1. Per-call tool params (`timeout_ms`, `max_bytes`, `engine`, …)
2. Project-local `.camoufox/config.json`
3. User-global `~/.config/camoufox-pi/config.json`
4. Environment variables (`CAMOUFOX_*`)
5. Built-in defaults

Schema (validated with `@sinclair/typebox`):

```jsonc
{
  "binaryPath": "...",                 // override camoufox-js's managed binary
  "timeout_ms": 30000,
  "max_bytes": 1048576,
  "max_lines": 5000,
  "defaultEngine": "google",
  "cachingEnabled": true,
  "onDiskCache": false,
  "retries": 2,
  "allowDomains": ["*.mdn.io", "*.python.org"],
  "blockDomains": ["pinterest.*", "*.medium.com"],
  "proxy": { "server": "http://…", "username": "…", "password": "…" },
  "fingerprint": { "os": "mac", "locale": "en-US" }   // camoufox fingerprint overrides
}
```

Config file watched with `fs.watch`; changes reload without session restart.

## 9. Observability

**Event bus** — emit on every operation:

```
camoufox:search         { query, engine, durationMs, resultCount, cached, spanId }
camoufox:fetch_url      { url, durationMs, status, bytes, spanId }
camoufox:browser_launch { durationMs, version }
camoufox:binary_download_progress { bytesDownloaded, bytesTotal }
camoufox:error          { type, ...payload, spanId }
```

Hosts like TFF subscribe and log to per-slice `.jsonl`.

**Metrics counters** (`client.getMetrics()`):

```typescript
{
  totalSearches, totalFetches, cacheHits, cacheMisses,
  retries, errors: { [type]: count },
  avgDurationMs, p95DurationMs,
  browserUptimeMs, browserRelaunches,
}
```

**Structured logs.** Route through `pi.log("camoufox", level, payload)` (or the host equivalent) instead of `console.log`. Each operation carries a span id for correlation.

## 10. Search Engine Adapters

One adapter per engine, implementing:

```typescript
interface SearchEngineAdapter {
  name: string;
  buildUrl(query: string, opts: SearchOptions): string;
  waitStrategy: { selector?: string; readyState?: "load" | "domcontentloaded" | "networkidle" };
  parseResults(page: Page): Promise<RawResult[]>;
  detectBlocked(page: Page): Promise<BlockedReason | null>;
}
```

Initial set: `google`, `duckduckgo`, `brave`, `bing`. Adding `kagi` (API, not scrape) gated on user providing an API key.

Parser strategy: **prefer DOM queries over markdown regex.** The lightpanda-pi content-extractor splits on markdown headings and fails on h4+ / raw URLs / embedded hashes. Here we have a real DOM — use `page.$$eval` against stable selectors. Add property-based tests per adapter.

## 11. Domain Allow/Block List

Applied post-parse to search results and pre-navigation for `fetch_url`:

```jsonc
{ "allowDomains": ["*.mdn.io"], "blockDomains": ["pinterest.*"] }
```

Glob matching via `micromatch` or equivalent. Blocked domains on `fetch_url` return `{ type: "config_invalid", field: "blockDomains", reason: "…" }` — the caller decides whether to override.

## 12. Testing Strategy

1. **Unit** — parsers, error mapping, config resolution, cache keying. Fast, no browser.
2. **Integration with Playwright route mocks.** Spin up a real Camoufox browser but intercept requests with `page.route()` and serve fixture HTML. Exercises the full navigation/extract path without hitting the network. Lives under `tests/integration/`.
3. **Contract tests per search-engine adapter.** Snapshot-style: given this fixture HTML, the adapter MUST produce this result array. Lock the parser behavior; catch regressions when a SERP redesign lands.
4. **E2E smoke in CI.** One real search against a stable public query (e.g. `site:python.org tutorial`) on each push. Catches Google SERP HTML changes and stealth regressions early. Tagged `@smoke`, can be skipped locally.
5. **Property-based parser tests.** Feed random markdown/HTML; assert invariants (no crashes, snippets ≤300 chars, URLs well-formed, titles non-empty).
6. **Bench harness.** `bun run bench` → 10 queries, report cold-start + per-query latency + p95. Track regressions on main.
7. **Fake camoufox-js seam.** `createClient({ _launcher: fakeLauncher })` lets tests inject a fake that returns a mocked Playwright `BrowserContext`. Avoids requiring the 300 MB binary in unit tests.

## 13. Package Structure

```
src/
├── index.ts                    # PI extension entry + tool registration
├── client.ts                   # CamoufoxClient (singleton, lifecycle, events)
├── launcher.ts                 # camoufox-js launch + binary management
├── config.ts                   # config resolution, validation, watcher
├── cache.ts                    # LRU + on-disk + request coalescing
├── errors.ts                   # CamoufoxError union + helpers
├── retry.ts                    # backoff policy
├── metrics.ts                  # counters + percentiles
├── logger.ts                   # structured log wrapper
├── blocked-detector.ts         # heuristics: CF/DataDome/PerimeterX
├── search/
│   ├── orchestrator.ts         # engine selection, caching, retry
│   ├── adapters/
│   │   ├── google.ts
│   │   ├── duckduckgo.ts
│   │   ├── brave.ts
│   │   └── bing.ts
│   └── types.ts
├── fetch/
│   ├── orchestrator.ts
│   └── extractors.ts           # markdown / html / text / selector-scoped
└── tools/
    ├── search_web.ts           # PI tool wrapper
    └── fetch_url.ts            # PI tool wrapper
tests/
├── unit/
├── integration/
└── fixtures/
docs/
└── SPEC.md                     # this file
```

## 14. Dependencies

**Runtime**
- `camoufox-js` (Apify)
- `playwright-core`
- `@sinclair/typebox` (config validation, aligned with lightpanda-pi)
- `micromatch` or `minimatch` (domain globs)
- A markdown converter for HTML → markdown — candidate: `turndown` (battle-tested) or `@mixmark-io/domino` + custom. Decide at implementation time.

**Peer** (aligned with lightpanda-pi)
- `@mariozechner/pi-coding-agent`
- `@mariozechner/pi-ai`
- `@mariozechner/pi-tui`

**Dev**
- `vitest`, `@biomejs/biome`, `typescript`, `lefthook`, `@commitlint/*` — mirror lightpanda-pi tooling.

## 15. Improvements Adopted From Lightpanda-PI Checklist (generic, non-Lightpanda-specific)

Direct mapping of each item from the checklist the user supplied:

| Checklist item | Status here |
|---|---|
| **A2** Programmatic API | ✅ §4 |
| **A3** Singleton client lifecycle, auto-reconnect | ✅ §2, §4 (`isAlive`, auto-reconnect) |
| **A4** Remove blocking `execSync` for binary detection | ✅ — never introduce it; use async `fs.stat` / `which` package |
| **B1** Discriminated-union error type | ✅ §5 |
| **B2** Retry with exponential backoff | ✅ §6 |
| **B3** Version check at init | ✅ `checkHealth()` reports camoufox-js + bundled binary version; warn on mismatch |
| **B4** Binary health probe | ✅ `checkHealth()` in §4 |
| **B5** AbortSignal propagation into browser session | ✅ abort closes the `Page` and rejects the op, not just drops the response |
| **B6** Parser correctness on odd markup | ✅ replaced entirely — DOM queries + per-engine adapters (§10) |
| **B7** Input validation & clamping on `max_results` | ✅ validate at tool boundary, clamp 1–50 |
| **B8** Structured empty-results handling | ✅ `{ results: [], reason: "no_matches" }` with per-adapter detection |
| **C1** `fetch_url` tool | ✅ §3.2 |
| **C2** Search-engine selection | ✅ §3.1, §10 |
| **C3** Domain allow/block list | ✅ §11 |
| **C4** Citation-ready output mode | ✅ `bibliography_markdown` in structured output, §3.1 |
| **C5** JS-rendered pages | ✅ `render_mode`, `wait_for_selector` — native in a real browser |
| **C6** Selector-based extraction | ✅ `selector` / `extract_selector` params |
| **C7** Screenshot capture | ✅ §3.2, §4 |
| **C8** Multi-query batch | ✅ `searchBatch` / `fetchUrlBatch` in §4 |
| **D1** In-memory LRU cache | ✅ §7 |
| **D2** Optional on-disk cache | ✅ §7 |
| **D3** Short-circuit concurrent identical requests | ✅ §7 (request coalescing) |
| **E1** PI event bus events | ✅ §9 |
| **E2** Metrics counters | ✅ §9 |
| **E3** Structured logs | ✅ §9 |
| **E4** Tracing span IDs | ✅ §9 (span id per op) |
| **F1** Single config source, layered | ✅ §8 |
| **F2** Per-call overrides | ✅ §3, §8 |
| **F3** Settings reload on change | ✅ §8 (fs.watch) |
| **G2** Align prompt guidelines with real behavior | ✅ at implementation time, document `engine`, `format`, and warning against redundant queries |
| **G3** Real wiring for the toggle slash command | ✅ §3.3 — must actually affect search-provider selection |
| **G4** Tool-call examples in README | ✅ at implementation time (this spec first, then README examples) |
| **H2** Property-based parser tests | ✅ §12 |
| **H3** E2E smoke test in CI | ✅ §12 |
| **H4** Bench harness | ✅ §12 |

**Dropped as Lightpanda-specific or N/A**

- A1 (CDP server mode) — camoufox-js already runs a long-lived Playwright browser; no fork+exec to escape.
- G1 ("Lightpana" typo) — N/A.
- H1 (fake CDP server seam) — replaced by fake `camoufox-js` launcher seam (§12).
- The whole `--user-agent` / `Sec-CH-UA` restriction discussion — Camoufox spoofs these at C++ level; nothing to work around.

## 16. Fingerprint Configuration

Camoufox accepts a fingerprint config at launch (UA, platform, timezone, locale, WebGL renderer/vendor, screen size, hardwareConcurrency, deviceMemory, fonts, voices, etc.). Default: let camoufox-js generate a realistic fingerprint via BrowserForge. Allow per-session override via config (§8 `fingerprint`).

**Persistence.** Cache the generated fingerprint in `~/.cache/camoufox-pi/fingerprint.json` so a user looks like the same browser across PI sessions. Opt-out: `fingerprint.persist: false`.

## 17. Known Limitations

Document these prominently in the README and in the tool's prompt guidelines so the LLM doesn't burn retries against impossible targets.

- **TLS/JA3 not spoofed.** Camoufox sends Firefox's ClientHello. Targets that fingerprint TLS (very aggressive DataDome, Akamai Bot Manager tier 3) will still detect. Mitigation: use a proxy such as `impit` or `curl-impersonate` between Camoufox and the network — out of scope for v1.
- **Canvas spoofer regression.** CloverLabsAI fork removed the canvas spoofer in 2026-03; pin to a binary version that includes it, or accept a ~100% unique BrowserLeaks canvas fingerprint. Decision: pin to the last pre-regression stable build; track upstream.
- **Firefox-identity.** Camoufox cannot mimic a Chromium UA convincingly (SpiderMonkey engine behavior is detectable). Anything requiring `window.chrome` / Client Hints / Chrome-specific APIs will fail. This is by design.
- **Memory.** 200–1300 MB RSS per session is the price of stealth. Don't run multiple parallel `CamoufoxClient` instances on small hosts — reuse the singleton.

## 18. Alternatives Considered

| Alternative | Decision | Reason |
|---|---|---|
| Fork Lightpanda + add stealth | rejected | Maintainer resistance, months of work, still missing canvas/WebGL/TLS |
| `playwright-extra` + `puppeteer-extra-plugin-stealth` | rejected | Runtime JS-patching is detectable; Camoufox's build-time patches are strictly more robust |
| `rebrowser-patches` / `rebrowser-playwright` | deferred | Valid Chromium-side alternative; re-evaluate if Camoufox maintenance lapses again |
| `patchright` (Python) | rejected for v1 | Python dependency; camoufox-js gives the same class of approach in Node |
| Wrap `jo-inc/camofox-browser` REST server | rejected for v1 | Adds a second process; loses programmatic `CamoufoxClient` ergonomics. Re-evaluate if we need its accessibility-snapshot feature |
| SearXNG / SerpAPI / Serper / Kagi API | partial | API path is better for "pure web search" — add `kagi` adapter when user supplies key. But doesn't solve `fetch_url` for bot-protected pages |

## 19. Open Questions For The Implementer

1. **Tool-name collision with lightpanda-pi.** Both packages register `tff-search_web` and `tff-fetch_url`? Or different names (`tff-stealth_search_web`)? Recommendation: same names, and PI config picks which package is active. Users rarely want both loaded.
2. **Default engine.** `google` is the best source but has the most aggressive anti-bot. Start with `google`, fall back to `duckduckgo` on `blocked`? Or default to `duckduckgo` and let the user opt into `google`? Ship with `google` default; fall back on repeated block.
3. **Fingerprint-per-query vs per-session.** Rotating per-query looks more human but breaks cookie continuity. Default: per-session, documented.
4. **Headful fallback via virtual display.** Camoufox headless is patched but some sites still probe headless specifically. Include an optional `virtualDisplay: true` that shells out to Xvfb on Linux? Skip for v1.
5. **Commercial licensing.** Camoufox is MPL-2.0. Consumers that bundle modifications need to stay open. Distribution story for bundled modifications (if any) must be reviewed before npm publish.

## 20. Versioning & Release

Mirror lightpanda-pi: release-please with conventional commits, npm publish with `publishConfig.access: public`, pin binaries via `camoufox-js`'s version. Major version bumps on breaking tool-surface changes; minor on new engines/features; patch on parser fixes.
