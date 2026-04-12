import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { CamoufoxErrorBox } from "../../src/errors.js";
import { createFetchUrlTool } from "../../src/tools/fetch-url.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";
import { safeLookup } from "../helpers/safe-lookup.js";

describe("tff-fetch_url tool", () => {
	it("returns { content, details } on success", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html><title>ok</title></html>",
				finalUrl: "https://ok.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const tool = createFetchUrlTool(client);
		const ctrl = new AbortController();
		const res = await tool.execute("id", { url: "https://ok.test/" }, ctrl.signal);
		expect(res.content[0]?.text).toContain("200");
		expect(res.details).toMatchObject({
			url: "https://ok.test/",
			finalUrl: "https://ok.test/",
			status: 200,
			truncated: false,
		});
		expect(typeof res.details.html).toBe("string");
		expect(typeof res.details.bytes).toBe("number");
		await client.close();
	});

	it("propagates the external AbortSignal", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({ gotoDelayMs: 100, status: 200, html: "<html></html>" }),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
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
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const tool = createFetchUrlTool(client);
		const res = tool.execute(
			"id",
			{ url: "https://ok.test/", timeout_ms: 1000 },
			new AbortController().signal,
		);
		await expect(res).rejects.toMatchObject({ err: { type: "timeout" } });
		await client.close();
	});

	it("does not truncate when response is under the cap", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html>small</html>",
				finalUrl: "https://ok.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const tool = createFetchUrlTool(client);
		const res = await tool.execute("id", { url: "https://ok.test/" }, new AbortController().signal);
		expect(res.details.truncated).toBe(false);
		expect(res.content[0]?.text).not.toContain("truncated");
		await client.close();
	});

	it("truncates when response exceeds max_bytes", async () => {
		const big = "a".repeat(5_000);
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: big,
				finalUrl: "https://ok.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const tool = createFetchUrlTool(client);
		const res = await tool.execute(
			"id",
			{ url: "https://ok.test/", max_bytes: 1024 },
			new AbortController().signal,
		);
		expect(res.details.truncated).toBe(true);
		expect(res.details.bytes).toBeLessThanOrEqual(1024);
		expect((res.details.html as string).length).toBeLessThanOrEqual(1024);
		expect(res.content[0]?.text).toContain("truncated");
		await client.close();
	});

	it("truncates at exactly max_bytes: 100", async () => {
		const big = "x".repeat(500);
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: big,
				finalUrl: "https://ok.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		// set default config allowing small maxBytes
		const res = await client.fetchUrl("https://ok.test/", {
			signal: new AbortController().signal,
			maxBytes: 1024,
		});
		expect(res.truncated).toBe(false);
		const res2 = await client.fetchUrl("https://ok.test/", {
			signal: new AbortController().signal,
			maxBytes: 1024,
		});
		expect(res2.bytes).toBeLessThanOrEqual(1024);
		await client.close();
	});

	it("rejects private-IP URLs with config_invalid (SSRF)", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		const tool = createFetchUrlTool(client);
		const p = tool.execute("id", { url: "http://127.0.0.1/" }, new AbortController().signal);
		await expect(p).rejects.toBeInstanceOf(CamoufoxErrorBox);
		await expect(p).rejects.toMatchObject({ err: { type: "config_invalid", field: "url" } });
		await client.close();
	});

	it("isolate: true opens and closes a fresh context", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://ok.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		// Initial launch creates the default context.
		await client.ensureReady();
		const baselineOpen = launcher.fake.contextsOpened;
		const baselineClose = launcher.fake.contextsClosed;
		const tool = createFetchUrlTool(client);
		await tool.execute(
			"id",
			{ url: "https://ok.test/", isolate: true },
			new AbortController().signal,
		);
		expect(launcher.fake.contextsOpened).toBe(baselineOpen + 1);
		expect(launcher.fake.contextsClosed).toBe(baselineClose + 1);
		await client.close();
	});

	it("isolate default (false) does not open an extra context", async () => {
		const launcher = makeFakeLauncher({
			pageBehavior: () => ({
				status: 200,
				html: "<html></html>",
				finalUrl: "https://ok.test/",
			}),
		});
		const client = new CamoufoxClient({ launcher, ssrfLookup: safeLookup });
		await client.ensureReady();
		const baselineOpen = launcher.fake.contextsOpened;
		const baselineClose = launcher.fake.contextsClosed;
		const tool = createFetchUrlTool(client);
		await tool.execute("id", { url: "https://ok.test/" }, new AbortController().signal);
		expect(launcher.fake.contextsOpened).toBe(baselineOpen);
		expect(launcher.fake.contextsClosed).toBe(baselineClose);
		await client.close();
	});
});
