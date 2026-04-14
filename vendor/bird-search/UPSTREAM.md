# bird-search (vendored)

Verbatim copy of `scripts/lib/vendor/bird-search/` from last30days-skill.

- **Source:** https://github.com/mvanhorn/last30days-skill
- **Origin path:** `scripts/lib/vendor/bird-search/`
- **Upstream package:** `@steipete/bird v0.8.0` (MIT)
- **Synced SHA:** 1157ea8afe0d3095047b25c54f2ea105a1a559f2
- **License:** MIT (see `LICENSE`)

## Rules

1. Files under `vendor/bird-search/` are **never edited** in-tree.
2. Integration lives in `src/sources/adapters/x/bird-search-shim.ts` (landing in M6 Task 11).
3. Upstream sync: recopy the directory and bump the SHA above in the same commit. Review the diff as part of PR.

## Integration contract (what the shim depends on)

Load-bearing exports consumed by `src/sources/adapters/x/bird-search-shim.ts`:

- `TwitterClientBase` from `./lib/twitter-client-base.js`
  - Constructor: `new TwitterClientBase({ cookies: { authToken, ct0, cookieHeader }, timeoutMs })`
  - Method: `fetchWithTimeout(url, init): Promise<Response>` — the shim subclasses and overrides this to route through our SSRF-guarded `httpFetch`. **If upstream renames or refactors this method away, the shim breaks silently — fall back to `globalThis.fetch`, leaking SSRF guards.**
- `withSearch` from `./lib/twitter-client-search.js`
  - Mixin: `withSearch(Base): class` with `.search(query, count): Promise<{ success: boolean; tweets?: BirdSearchRow[]; error?: string }>`

## Normalized row shape (`BirdSearchRow`)

bird-search's `.search()` returns tweets in this shape (see `src/sources/adapters/x/graphql-to-source-item.ts` for our `BirdSearchRow` type):

```
{
  id: string,
  text: string,
  createdAt: string,           // raw Twitter "Wed Apr 01 12:00:00 +0000 2026"
  author: { username: string, name: string },
  authorId: string,
  replyCount?: number,
  retweetCount?: number,
  likeCount?: number,
}
```

If these keys rename upstream (e.g. `likeCount` → `favoriteCount`), update `BirdSearchRow` in lockstep.
