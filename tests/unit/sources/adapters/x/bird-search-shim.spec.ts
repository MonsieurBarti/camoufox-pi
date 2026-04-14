import { describe, expect, it } from "vitest";
import { CamoufoxErrorBox } from "../../../../../src/errors.js";
import { runBirdSearch } from "../../../../../src/sources/adapters/x/bird-search-shim.js";
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
});
