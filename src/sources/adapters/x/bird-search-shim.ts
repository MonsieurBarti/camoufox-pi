// @ts-ignore — vendor JS, no declaration file
import { TwitterClientBase } from "../../../../vendor/bird-search/lib/twitter-client-base.js";
// @ts-ignore — vendor JS, no declaration file
import { withSearch } from "../../../../vendor/bird-search/lib/twitter-client-search.js";
import type { HttpFetch } from "../../../client/http-fetch.js";
import { CamoufoxErrorBox } from "../../../errors.js";
import type { BirdSearchRow } from "./graphql-to-source-item.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SearchClient = withSearch(TwitterClientBase);

export interface RunBirdSearchOpts {
	readonly query: string;
	readonly limit: number;
	readonly cookies: { auth_token: string; ct0: string };
	readonly httpFetch: HttpFetch;
	readonly signal?: AbortSignal;
}

interface FetchInit {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
}

function buildInjectedClient(opts: RunBirdSearchOpts): InstanceType<typeof SearchClient> {
	// Create a subclass that overrides fetchWithTimeout to route through httpFetch.
	// We do this per-call (rather than a module-level subclass) so each client
	// instance carries its own httpFetch/signal closure — no shared state, no
	// monkey-patch, no concurrency leak.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	class InjectedSearchClient extends SearchClient {
		// biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
		constructor(...args: any[]) {
			// eslint-disable-line @typescript-eslint/no-explicit-any
			super(...args); // eslint-disable-line @typescript-eslint/no-unsafe-call
		}
		async fetchWithTimeout(url: string, init: FetchInit = {}): Promise<Response> {
			const method = (init.method as "GET" | "POST" | undefined) ?? "GET";
			const resp = await opts.httpFetch(url, {
				method,
				...(init.headers !== undefined ? { headers: init.headers } : {}),
				...(typeof init.body === "string" ? { body: init.body } : {}),
				...(opts.signal !== undefined ? { signal: opts.signal } : {}),
			});
			return new Response(resp.body, {
				status: resp.status,
				headers: resp.headers,
			});
		}
	}
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
	return new InjectedSearchClient({
		cookies: {
			authToken: opts.cookies.auth_token,
			ct0: opts.cookies.ct0,
			cookieHeader: `auth_token=${opts.cookies.auth_token}; ct0=${opts.cookies.ct0}`,
		},
		timeoutMs: 30_000,
	});
}

export async function runBirdSearch(opts: RunBirdSearchOpts): Promise<BirdSearchRow[]> {
	if (opts.signal?.aborted) {
		const err = new Error("aborted");
		err.name = "AbortError";
		throw err;
	}
	const client = buildInjectedClient(opts);
	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		const result = await client.search(opts.query, opts.limit);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		if (result.success) {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
			return result.tweets as BirdSearchRow[];
		}
		// Classify the error. bird-search reports errors as strings like "HTTP 401: ...", "HTTP 429: ...", etc.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
		throw classifyBirdSearchError((result.error as string | undefined) ?? "unknown error");
	} catch (err) {
		if (err instanceof CamoufoxErrorBox) throw err;
		if (err instanceof Error && err.name === "AbortError") throw err;
		throw new CamoufoxErrorBox({
			type: "source_unavailable",
			source: "x",
			cause: err instanceof Error ? err.message : String(err),
		});
	}
}

const AUTH_KEYWORDS = /auth|not authenticated|bad session|session expired|not authorized/i;

function classifyBirdSearchError(message: string): CamoufoxErrorBox {
	const httpMatch = /^HTTP (\d{3})(?::\s*(.*))?$/.exec(message);
	if (httpMatch) {
		const status = Number(httpMatch[1]);
		if (status === 401 || status === 403) {
			return new CamoufoxErrorBox({
				type: "session_expired",
				source: "x",
				credentialKey: "cookies",
			});
		}
		if (status === 429) {
			const retrySec = parseRetryAfter(httpMatch[2] ?? "");
			return new CamoufoxErrorBox({
				type: "source_rate_limited",
				source: "x",
				...(retrySec !== undefined ? { retryAfterSec: retrySec } : {}),
			});
		}
		if (status >= 500 && status <= 599) {
			return new CamoufoxErrorBox({
				type: "source_unavailable",
				source: "x",
				cause: `HTTP ${status}`,
			});
		}
	}
	if (AUTH_KEYWORDS.test(message)) {
		return new CamoufoxErrorBox({ type: "session_expired", source: "x", credentialKey: "cookies" });
	}
	return new CamoufoxErrorBox({ type: "source_unavailable", source: "x", cause: message });
}

function parseRetryAfter(tail: string): number | undefined {
	const m = /retry[- ]after[:= ]*(\d+)/i.exec(tail);
	if (m?.[1]) {
		const n = Number(m[1]);
		return Number.isFinite(n) ? n : undefined;
	}
	return undefined;
}
