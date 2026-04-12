# @the-forge-flow/camoufox-pi

PI extension for **stealth web search and URL fetching** via [Camoufox](https://github.com/daijro/camoufox) — a Firefox fork patched at the C++ level for anti-fingerprint resistance.

Sibling to [`@the-forge-flow/lightpanda-pi`](../lightpanda). Where `lightpanda-pi` is the fast/light choice for cooperative targets, `camoufox-pi` is the choice when sites actively block bots (Google, Cloudflare, LinkedIn, DataDome, PerimeterX, Turnstile, etc.).

## Why a separate package

Lightpanda's maintainers have explicitly refused to support bot-evasion (see [lightpanda issues #990, #1177, #1436](https://github.com/lightpanda-io/browser/issues/990)). Its `--user-agent` flag rejects any value containing `mozilla`; `Sec-CH-UA: "Lightpanda";v="1"` is hardcoded; `navigator.webdriver` doesn't exist; no canvas/WebGL; libcurl TLS fingerprint. Cloudflare Turnstile detects it in milliseconds.

Camoufox patches fingerprint surfaces **inside SpiderMonkey / Gecko C++**, before JavaScript can observe them — making it fundamentally more robust than runtime JS-injection approaches like `puppeteer-extra-plugin-stealth`. Independent benchmarks report ~100% bypass rate vs ~33% for Playwright-Chromium.

## Trade-offs vs lightpanda-pi

| | lightpanda-pi | camoufox-pi |
|---|---|---|
| RSS per session | ~50 MB | 200–1300 MB |
| Binary size | few MB | 300–700 MB (lazy download on first use) |
| Cold start | instant | 1–3 s |
| Cooperative sites | ✅ | ✅ |
| WAF-protected sites | ❌ | ✅ |
| Canvas/WebGL | not rendered | spoofed (except post-2026-03 regression — see SPEC §17) |
| TLS/JA3 fingerprint | libcurl | Firefox (unspoofed — use proxy if target fingerprints TLS) |

Pick one based on target profile. They can coexist but share no runtime.

## Documentation

- **[docs/SPEC.md](docs/SPEC.md)** — full design spec (architecture, API surface, tools, error model, config, caching, observability, testing).
- Implementation plan TBD by the implementer.
