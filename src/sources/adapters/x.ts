import type { SourceAdapter } from "../types.js";
import { runBirdSearch } from "./x/bird-search-shim.js";
import { toSourceItem, withinLookback } from "./x/graphql-to-source-item.js";
import { extractXCookies, parseStorageState } from "./x/storage-state.js";

export function xAdapter(): SourceAdapter {
	return {
		name: "x",
		tier: 2,
		requiredCredentials: [
			{
				kind: "cookie_jar",
				key: "cookies",
				description: "X (Twitter) session cookies for search access",
				loginUrl: "https://x.com/login",
				// Matches logged-in-looking URLs. Excludes login/signup/logout flow pages
				// so we don't false-positive on a user still in the auth flow.
				loggedInUrlPattern:
					/^https:\/\/x\.com\/(?:home|i\/(?!flow)[^?#/]+|(?!login\b|logout\b|signup\b|i\b|oauth\b)[^/]+\/?$)/,
			},
		],
		async fetch(query, opts, ctx) {
			const stateJson = await ctx.credentials.require("cookies");
			const state = parseStorageState(stateJson);
			const cookies = extractXCookies(state);
			const rows = await runBirdSearch({
				query,
				limit: opts.limit,
				cookies,
				httpFetch: ctx.httpFetch,
				...(opts.signal !== undefined ? { signal: opts.signal } : {}),
			});
			return rows
				.map(toSourceItem)
				.filter((item) => withinLookback(item.publishedAt, opts.lookbackDays));
		},
	};
}
