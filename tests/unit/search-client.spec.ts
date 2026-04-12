import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.search", () => {
	it("returns structured results from the DDG adapter", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				finalUrl: "https://html.duckduckgo.com/html/?q=foo",
				evalResults: {
					"div.result, div.web-result": [
						{ title: "First", url: "https://one.test/", snippet: "the first" },
						{ title: "Second", url: "https://two.test/", snippet: "the second" },
					],
				},
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.search("foo", { signal: new AbortController().signal });
		expect(res.engine).toBe("duckduckgo");
		expect(res.query).toBe("foo");
		expect(res.results).toEqual([
			{ title: "First", url: "https://one.test/", snippet: "the first", rank: 1 },
			{ title: "Second", url: "https://two.test/", snippet: "the second", rank: 2 },
		]);
		await client.close();
	});

	it("empty results returns { results: [] }, not an error", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				evalResults: { "div.result, div.web-result": [] },
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.search("nothing", { signal: new AbortController().signal });
		expect(res.results).toEqual([]);
		await client.close();
	});

	it("rejects out-of-range maxResults as config_invalid", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.search("x", {
			signal: new AbortController().signal,
			maxResults: 0,
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "config_invalid", field: "maxResults" },
		});
		await client.close();
	});

	it("respects maxResults", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				evalResults: {
					"div.result, div.web-result": Array.from({ length: 5 }, (_, i) => ({
						title: `T${i}`,
						url: `https://t${i}.test/`,
						snippet: `s${i}`,
					})),
				},
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.search("x", { signal: new AbortController().signal, maxResults: 2 });
		expect(res.results.length).toBe(2);
		await client.close();
	});
});
