// @ts-ignore — vendor JS, no declaration file
import { TwitterClientBase } from "../../../../vendor/bird-search/lib/twitter-client-base.js";
// @ts-ignore — vendor JS, no declaration file
import { withSearch } from "../../../../vendor/bird-search/lib/twitter-client-search.js";
import type { HttpFetchEvent, SourceFetchEvent } from "../../../client/events.js";
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
	readonly emit: (e: SourceFetchEvent | HttpFetchEvent) => void;
}

export async function runBirdSearch(opts: RunBirdSearchOpts): Promise<BirdSearchRow[]> {
	if (opts.signal?.aborted) {
		const err = new Error("aborted");
		err.name = "AbortError";
		throw err;
	}

	// Build the webFetch that routes through httpFetch, emits events, and classifies errors.
	const webFetch: typeof fetch = async (input, init) => {
		const url =
			typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const method = (init?.method as "GET" | "POST" | undefined) ?? "GET";
		const startedAt = Date.now();
		const rawHeaders = init?.headers as Record<string, string> | undefined;
		const resp = await opts.httpFetch(url, {
			method,
			...(rawHeaders !== undefined ? { headers: rawHeaders } : {}),
			...(typeof init?.body === "string" ? { body: init.body } : {}),
			...(opts.signal !== undefined ? { signal: opts.signal } : {}),
		});
		opts.emit({
			spanId: "",
			source: "x",
			url: resp.url,
			status: resp.status,
			durationMs: Date.now() - startedAt,
		});
		// Return a minimal web-Response for bird-search to consume.
		return new Response(resp.body, {
			status: resp.status,
			headers: resp.headers,
		});
	};

	const originalFetch = globalThis.fetch;
	// Monkey-patch globalThis.fetch for the duration of the search call.
	globalThis.fetch = webFetch;
	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
		const client = new SearchClient({
			cookies: {
				authToken: opts.cookies.auth_token,
				ct0: opts.cookies.ct0,
				cookieHeader: `auth_token=${opts.cookies.auth_token}; ct0=${opts.cookies.ct0}`,
			},
			timeoutMs: 30_000,
		});
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
	} finally {
		globalThis.fetch = originalFetch;
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
