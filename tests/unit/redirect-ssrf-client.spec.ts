import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("CamoufoxClient.fetchUrl — redirect-SSRF guard wiring (regression)", () => {
	it("still throws network when goto rejects with no guard-recorded block", async () => {
		// Guard is attached but no handler was fired, so getBlockedHop() is null.
		// navigate() should still map the raw goto failure via mapPlaywrightError.
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				gotoError: new Error("net::ERR_NAME_NOT_RESOLVED"),
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const p = client.fetchUrl("https://nope.test/", {
			signal: new AbortController().signal,
		});
		await expect(p).rejects.toMatchObject({
			err: { type: "network", url: "https://nope.test/" },
		});
		await client.close();
	});

	it("still returns a successful result when goto resolves and no block recorded", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html>ok</html>",
				finalUrl: "https://example.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const res = await client.fetchUrl("https://example.test/", {
			signal: new AbortController().signal,
		});
		expect(res.status).toBe(200);
		expect(res.html).toContain("ok");
		await client.close();
	});
});
