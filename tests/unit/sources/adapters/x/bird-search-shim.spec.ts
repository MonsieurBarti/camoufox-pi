import { describe, expect, it } from "vitest";
import { CamoufoxErrorBox } from "../../../../../src/errors.js";
import {
	classifyBirdSearchError,
	runBirdSearch,
} from "../../../../../src/sources/adapters/x/bird-search-shim.js";
import { createFakeHttpFetch } from "../../../../helpers/fake-http-fetch.js";

// The real bird-search client calls https://x.com/i/api/graphql/<queryId>/SearchTimeline?...
// Use the prefix to match all search requests.
const SEARCH_PREFIX = "https://x.com/i/api/graphql";

function makeOpts(httpFetch: ReturnType<typeof createFakeHttpFetch>, signal?: AbortSignal) {
	return {
		query: "test query",
		limit: 5,
		cookies: { auth_token: "fake_auth", ct0: "fake_ct0" },
		httpFetch,
		...(signal !== undefined ? { signal } : {}),
	};
}

async function catchErr(p: Promise<unknown>): Promise<unknown> {
	try {
		await p;
		return null;
	} catch (e) {
		return e;
	}
}

describe("runBirdSearch", () => {
	it("throws AbortError when pre-aborted", async () => {
		const ac = new AbortController();
		ac.abort();
		const httpFetch = createFakeHttpFetch({});
		const err = await catchErr(runBirdSearch(makeOpts(httpFetch, ac.signal)));
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).name).toBe("AbortError");
	});

	it("classifies 401 HTTP error as session_expired", async () => {
		const httpFetch = createFakeHttpFetch({
			[SEARCH_PREFIX]: { status: 401, body: "Unauthorized", headers: {} },
		});
		const err = await catchErr(runBirdSearch(makeOpts(httpFetch)));
		expect(err).toBeInstanceOf(CamoufoxErrorBox);
		expect((err as CamoufoxErrorBox).err.type).toBe("session_expired");
	});

	it("classifies 403 HTTP error as session_expired", async () => {
		const httpFetch = createFakeHttpFetch({
			[SEARCH_PREFIX]: { status: 403, body: "Forbidden", headers: {} },
		});
		const err = await catchErr(runBirdSearch(makeOpts(httpFetch)));
		expect(err).toBeInstanceOf(CamoufoxErrorBox);
		expect((err as CamoufoxErrorBox).err.type).toBe("session_expired");
	});

	it("classifies 429 HTTP error as source_rate_limited", async () => {
		const httpFetch = createFakeHttpFetch({
			[SEARCH_PREFIX]: { status: 429, body: "Too Many Requests", headers: {} },
		});
		const err = await catchErr(runBirdSearch(makeOpts(httpFetch)));
		expect(err).toBeInstanceOf(CamoufoxErrorBox);
		expect((err as CamoufoxErrorBox).err.type).toBe("source_rate_limited");
	});

	it("classifies 500 HTTP error as source_unavailable", async () => {
		const httpFetch = createFakeHttpFetch({
			[SEARCH_PREFIX]: { status: 500, body: "Internal Server Error", headers: {} },
		});
		const err = await catchErr(runBirdSearch(makeOpts(httpFetch)));
		expect(err).toBeInstanceOf(CamoufoxErrorBox);
		expect((err as CamoufoxErrorBox).err.type).toBe("source_unavailable");
	});

	it("does not mutate globalThis.fetch", async () => {
		const before = globalThis.fetch;
		const httpFetch = createFakeHttpFetch({
			"*": { status: 401, headers: {}, body: "" },
		});
		await catchErr(
			runBirdSearch({
				query: "q",
				limit: 5,
				cookies: { auth_token: "A", ct0: "C" },
				httpFetch,
			}),
		);
		expect(globalThis.fetch).toBe(before);
	});

	it("never calls globalThis.fetch (SSRF/cookie leak prevention)", async () => {
		const original = globalThis.fetch;
		let calls = 0;
		globalThis.fetch = ((...args: unknown[]) => {
			calls += 1;
			return original.apply(globalThis, args as Parameters<typeof fetch>);
		}) as typeof fetch;
		try {
			// A 404 response is the condition under which the vendored client would
			// call refreshQueryIds() (via withRefreshedQueryIdsOn404) in production.
			// Our override must intercept that path and keep calls at zero.
			const httpFetch = createFakeHttpFetch({ "*": { status: 404, headers: {}, body: "" } });
			await catchErr(
				runBirdSearch({
					query: "q",
					limit: 5,
					cookies: { auth_token: "A", ct0: "C" },
					httpFetch,
				}),
			);
			expect(calls).toBe(0);
		} finally {
			globalThis.fetch = original;
		}
	});
});

describe("classifyBirdSearchError", () => {
	it("maps GraphQL 200 auth error strings to session_expired", () => {
		const cases = [
			"Not authorized: session expired",
			"not authenticated: token rejected",
			"bad session",
			"Authorization failed",
		];
		for (const msg of cases) {
			const e = classifyBirdSearchError(msg);
			expect(e.err.type).toBe("session_expired");
			if (e.err.type === "session_expired") {
				expect(e.err.source).toBe("x");
				expect(e.err.credentialKey).toBe("cookies");
			}
		}
	});

	it("maps non-auth GraphQL 200 error strings to source_unavailable", () => {
		const e = classifyBirdSearchError("Rate limit reached for resource X");
		expect(e.err.type).toBe("source_unavailable");
		if (e.err.type === "source_unavailable") {
			expect(e.err.source).toBe("x");
		}
	});

	it("maps HTTP-status error strings first, falling through to keyword check", () => {
		const e429 = classifyBirdSearchError("HTTP 429: retry-after=30");
		expect(e429.err.type).toBe("source_rate_limited");

		const e500 = classifyBirdSearchError("HTTP 500: internal error");
		expect(e500.err.type).toBe("source_unavailable");

		const e401 = classifyBirdSearchError("HTTP 401: unauthorized");
		expect(e401.err.type).toBe("session_expired");
	});
});
