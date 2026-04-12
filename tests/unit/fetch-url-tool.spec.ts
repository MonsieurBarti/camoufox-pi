import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { CamoufoxErrorBox } from "../../src/errors.js";
import { createFetchUrlTool } from "../../src/tools/fetch-url.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";

describe("tff-fetch_url tool", () => {
	it("returns { content, details } on success", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html><title>ok</title></html>",
				finalUrl: "https://ok.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher });
		const tool = createFetchUrlTool(client);
		const ctrl = new AbortController();
		const res = await tool.execute("id", { url: "https://ok.test/" }, ctrl.signal);
		expect(res.content[0]?.text).toContain("200");
		expect(res.details).toMatchObject({
			url: "https://ok.test/",
			finalUrl: "https://ok.test/",
			status: 200,
		});
		expect(typeof res.details.html).toBe("string");
		expect(typeof res.details.bytes).toBe("number");
		await client.close();
	});

	it("propagates the external AbortSignal", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ gotoDelayMs: 100, status: 200, html: "<html></html>" }),
		});
		const client = new CamoufoxClient({ launcher });
		const tool = createFetchUrlTool(client);
		const ctrl = new AbortController();
		const p = tool.execute("id", { url: "https://ok.test/" }, ctrl.signal);
		ctrl.abort();
		await expect(p).rejects.toBeInstanceOf(CamoufoxErrorBox);
		await expect(p).rejects.toMatchObject({ err: { type: "aborted" } });
		await client.close();
	});

	it("respects timeout_ms param", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				gotoError: Object.assign(new Error("Timeout"), { name: "TimeoutError" }),
			}),
		});
		const client = new CamoufoxClient({ launcher });
		const tool = createFetchUrlTool(client);
		const res = tool.execute(
			"id",
			{ url: "https://ok.test/", timeout_ms: 1000 },
			new AbortController().signal,
		);
		await expect(res).rejects.toMatchObject({ err: { type: "timeout" } });
		await client.close();
	});
});
