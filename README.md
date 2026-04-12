<div align="center">
  <img src="https://raw.githubusercontent.com/MonsieurBarti/The-Forge-Flow-CC/refs/heads/main/assets/forge-banner.png" alt="The Forge Flow" width="100%">

  <h1>@the-forge-flow/camoufox-pi</h1>

  <p>
    <strong>Stealth web search and URL fetching for the PI coding agent</strong>
  </p>

  <p>
    <a href="https://github.com/MonsieurBarti/camoufox-pi/actions/workflows/ci.yml">
      <img src="https://img.shields.io/github/actions/workflow/status/MonsieurBarti/camoufox-pi/ci.yml?label=CI&style=flat-square" alt="CI Status">
    </a>
    <a href="https://www.npmjs.com/package/@the-forge-flow/camoufox-pi">
      <img src="https://img.shields.io/npm/v/@the-forge-flow/camoufox-pi?style=flat-square" alt="npm version">
    </a>
    <a href="LICENSE">
      <img src="https://img.shields.io/github/license/MonsieurBarti/camoufox-pi?style=flat-square" alt="License">
    </a>
  </p>
</div>

---

## What it does

PI extension that wraps [Camoufox](https://github.com/daijro/camoufox) — a Firefox fork patched at the C++ level for anti-fingerprint resistance — to give the coding agent a stealth-capable web search and URL fetcher. For sites that block conventional headless browsers (Cloudflare, DataDome, PerimeterX, Turnstile, Google's bot wall, LinkedIn, etc.).

Sibling to [`@the-forge-flow/lightpanda-pi`](https://github.com/MonsieurBarti/lightpanda-pi). Where `lightpanda-pi` is the fast/light choice for cooperative targets, `camoufox-pi` is the choice when sites actively block bots. Camoufox patches fingerprint surfaces inside SpiderMonkey / Gecko C++, before JavaScript can observe them — fundamentally more robust than runtime JS-injection approaches like `puppeteer-extra-plugin-stealth`. Independent benchmarks report ~100% bypass rate vs ~33% for Playwright-Chromium.

## Features

- `tff-fetch_url` — fetch a URL via stealth Firefox and return HTML
- `tff-search_web` — web search via DuckDuckGo (Google lands in a follow-up slice)
- **Stealth properties** — C++-level fingerprint spoofing, patched canvas/WebGL, Juggler (Firefox remote) protocol — not CDP
- **SSRF protection** — private IP ranges, link-local, loopback, cloud metadata, and CGNAT blocked pre-navigation
- **Scheme allow-list** — only `http:` / `https:` accepted at the tool boundary; `file:`, `javascript:`, `data:`, `chrome://` rejected
- **Response size caps** — UTF-8-safe truncation at `max_bytes` (default 2 MiB, max 50 MiB) with `truncated` flag
- **`isolate: true` opt-in** — one-shot browser context per call, no cookie/storage bleed
- **Lazy binary download** — ~500 MB Camoufox binary fetched on first use, not install

## Trade-offs vs lightpanda-pi

| | lightpanda-pi | camoufox-pi |
|---|---|---|
| RSS per session | ~50 MB | 200–1300 MB |
| Binary size | few MB | 300–700 MB (lazy download on first use) |
| Cold start | instant | 1–3 s |
| Cooperative sites | yes | yes |
| WAF-protected sites | no | yes |
| Canvas/WebGL | not rendered | spoofed (except post-2026-03 regression — see SPEC §17) |
| TLS/JA3 fingerprint | libcurl | Firefox (unspoofed — use proxy if target fingerprints TLS) |

Pick one based on target profile. They can coexist but share no runtime.

## Requirements

- Node.js >= 22.5.0
- PI (`pi` CLI) installed
- ~500 MB disk space for the Camoufox binary (lazy downloaded on first use)
- macOS or Linux (Windows untested)

## Installation

```bash
# From npm (recommended)
pi install npm:@the-forge-flow/camoufox-pi

# Project-local only
pi install -l npm:@the-forge-flow/camoufox-pi

# From GitHub (tracks main)
pi install git:github.com/MonsieurBarti/camoufox-pi

# Pin a version
pi install npm:@the-forge-flow/camoufox-pi@0.1.0
```

Then reload PI with `/reload` (or restart it). First tool call downloads the Camoufox binary (~500 MB, one-time).

## Usage

### Tools

| Tool | Description | Key parameters |
|---|---|---|
| `tff-fetch_url` | Fetch a URL via stealth Firefox, return HTML | `url`, `timeout_ms`, `max_bytes`, `isolate` |
| `tff-search_web` | Web search (DuckDuckGo) | `query`, `max_results`, `timeout_ms`, `isolate` |

**`tff-fetch_url`** returns `{ url, finalUrl, status, html, bytes, truncated }`. HTML is returned raw (no markdown conversion in v0.1.0). `truncated: true` means the response exceeded `max_bytes` and was cut at a UTF-8-safe boundary.

**`tff-search_web`** returns `{ engine, query, results[], atLimit }` where each result is `{ title, url, snippet, rank }`. `atLimit` means `results.length === max_results` — could mean DDG had more, or exactly that many. No ground-truth "has_more" signal is available from the engine.

### Security

- **Scheme allow-list.** Only `http:` and `https:` accepted at the tool boundary. `file:`, `javascript:`, `data:`, `chrome://` and similar are rejected before any navigation.
- **SSRF protection.** Targets that resolve to private IP ranges (loopback, RFC1918, link-local, cloud metadata 169.254.169.254, CGNAT, IPv6 ULAs) are rejected pre-navigation. No opt-out in v0.1.0.
- **Response truncation.** Bodies exceeding `max_bytes` are cut at a UTF-8-safe byte boundary and flagged `truncated: true`. Default 2 MiB, max 50 MiB.
- **Untrusted content.** The `tff-fetch_url` prompt guidelines explicitly warn the LLM that fetched HTML is UNTRUSTED and must not be executed, eval'd, or treated as authoritative instructions.
- **`isolate: true`** for sensitive fetches — fresh `BrowserContext` per call, no cookie/storage reuse with the shared session context.

## Configuration

v0.1.0 does **not** load a config file. All configuration is per-call via tool parameters. A layered config (project-local + user-global + env + fs.watch reload) lands in a later slice — see [docs/SPEC.md](docs/SPEC.md) §8.

Defaults baked into `DEFAULT_CONFIG`:

| Field | Default | Description |
|---|---|---|
| `timeoutMs` | `30000` | Per-navigation timeout (ms), overridable via `timeout_ms` |
| `maxBytes` | `2097152` | 2 MiB response cap for `fetch_url`, overridable via `max_bytes` |
| `defaultEngine` | `"duckduckgo"` | Only valid value in v0.1.0 |

## Architecture

```
┌─────────────────────┐
│ PI host process      │
│ └─ loads extension   │
└─────────┬────────────┘
          │  session_start
          ▼
┌──────────────────────────────────────────────────────┐
│ camoufox-pi extension (in PI process)                │
│                                                      │
│   CamoufoxService (singleton)                        │
│   └─ CamoufoxClient                                  │
│       ├─ one Browser                                 │
│       ├─ one BrowserContext (cookies persist)        │
│       └─ Launcher (camoufox-js, isolated)            │
│                                                      │
│   Tools: tff-fetch_url / tff-search_web ─┐           │
│                                          ▼           │
│                             CamoufoxClient.navigate  │
└──────────────────────────────────────────────────────┘
                         │  Playwright (Juggler)
                         ▼
              ┌──────────────────────┐
              │ Camoufox process     │
              │ (patched Firefox)    │
              └──────────────────────┘
```

**Launcher isolation.** `src/client/launcher.ts` is the **only** file that imports `camoufox-js`. Every other file uses the `Launcher` interface. This keeps the third-party Node wrapper (Apify's port of Python-official Camoufox) swappable — a future official binding, patchright, or a Python subprocess slots in with a one-file change.

**Fake-launcher test seam.** `tests/helpers/fake-launcher.ts` injects a stub `BrowserContext` so every unit test runs without downloading the ~500 MB binary or spawning a real Firefox.

Key components in `src/`:

| File | Purpose |
|---|---|
| `src/index.ts` | Extension factory — session lifecycle, tool/command/hook registration |
| `src/services/camoufox-service.ts` | Singleton service owning the `CamoufoxClient`, kicks off `ensureReady()` from `session_start` |
| `src/client/camoufox-client.ts` | Lifecycle + `navigate` + `fetchUrl` + `search` + `close` |
| `src/client/launcher.ts` | `Launcher` interface + `RealLauncher` (sole `camoufox-js` importer) |
| `src/client/signal.ts` | `combineSignals(external, timeoutMs)` — turn-signal + timeout composition |
| `src/errors.ts` | `CamoufoxError` discriminated union + `CamoufoxErrorBox` + `mapPlaywrightError` |
| `src/security/ssrf.ts` | Private-IP + link-local + cloud-metadata blocklist, pre-navigation |
| `src/search/adapters/duckduckgo.ts` | DOM-query SERP parser against `html.duckduckgo.com` |
| `src/tools/fetch-url.ts` | `tff-fetch_url` tool definition |
| `src/tools/search-web.ts` | `tff-search_web` tool definition |
| `src/tools/formats.ts` | TypeBox `format: "uri"` scheme allow-list hook |
| `src/tools/types.ts` | `ToolDefinition` structural interface |
| `src/types.ts` | `CamoufoxConfig` + `DEFAULT_CONFIG` |

## Development

```bash
bun install              # install deps
bun run test             # vitest once
bun run test:watch       # vitest watch mode
bun run test:coverage    # v8 coverage
bun run lint             # biome check
bun run lint:fix         # auto-fix
bun run build            # tsc → dist/
bun run typecheck        # type-only check
```

Pre-commit hooks (lefthook) run biome, typecheck, and tests in parallel.

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) — enforced by commitlint.

## Known limitations

v0.1.0 is the foundational slice. The following are deliberately deferred to later slices (tracked in [docs/SPEC.md](docs/SPEC.md)):

- **DuckDuckGo only.** Google / Brave / Bing adapters land in follow-up slices; Google requires stealth tuning that deserves its own slice.
- **No retries.** `network`, `timeout`, `playwright_disconnected`, and `browser_crashed` surface as errors — no exponential backoff.
- **No cache.** No in-memory LRU, no on-disk cache, no request coalescing.
- **No blocked-detection.** CF/DataDome/PerimeterX challenge pages return as HTTP 200 with challenge HTML; no structured `{ type: "blocked" }` yet.
- **No observability.** No metrics, no event-bus events, no span IDs. `binary_download_progress` not emitted (only `console.debug`).
- **No config layering.** No config file, no env vars, no `fs.watch` reload. Per-call params and `DEFAULT_CONFIG` only.
- **TLS/JA3 fingerprint not spoofed.** Camoufox inherits Firefox's ClientHello. Targets that fingerprint TLS (aggressive DataDome, Akamai Bot Manager tier 3) will still detect. Mitigation deferred to a proxy-integration slice.
- **Sticky launch failure.** A failed `ensureReady()` marks the client permanently failed. Retrying requires reconstructing the service. Auto-reconnect lands in the retry-and-reconnect slice.
- **Third-party Node wrapper.** Upstream Camoufox endorses only the Python wrapper. `camoufox-js` (Apify, MPL-2.0) is the Node port; launcher isolation keeps it swappable.

See [docs/SPEC.md](docs/SPEC.md) §17 for the full limitations list and [docs/superpowers/specs/2026-04-12-foundational-slice-design.md](docs/superpowers/specs/2026-04-12-foundational-slice-design.md) §7 for the deferred-feature landing plan.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing`)
3. Commit with conventional commits (`git commit -m "feat: add something"`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

## License

MIT
