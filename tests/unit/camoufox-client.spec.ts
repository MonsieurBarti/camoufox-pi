import { describe, expect, it } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import { CamoufoxErrorBox } from "../../src/errors.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";

describe("CamoufoxClient lifecycle", () => {
	it("starts not-alive, becomes alive after ensureReady", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		expect(client.isAlive()).toBe(false);
		await client.ensureReady();
		expect(client.isAlive()).toBe(true);
		await client.close();
	});

	it("is idempotent: N concurrent ensureReady calls produce one launch", async () => {
		const launcher = makeFakeLauncher({ launchDelayMs: 20 });
		const client = new CamoufoxClient({ launcher });
		await Promise.all([client.ensureReady(), client.ensureReady(), client.ensureReady()]);
		expect(launcher.fake.launchCount).toBe(1);
		await client.close();
	});

	it("ensureReady after success resolves instantly without relaunching", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		await client.ensureReady();
		await client.ensureReady();
		expect(launcher.fake.launchCount).toBe(1);
		await client.close();
	});

	it("close() twice is safe", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		await client.ensureReady();
		await client.close();
		await client.close();
		expect(client.isAlive()).toBe(false);
	});

	it("isAlive() returns false after the browser disconnects", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		await client.ensureReady();
		expect(client.isAlive()).toBe(true);
		launcher.fake.setConnected(false);
		expect(client.isAlive()).toBe(false);
		await client.close();
	});

	it("wraps a launch failure as browser_launch_failed (sticky)", async () => {
		const launcher = makeFakeLauncher({ launchFails: new Error("boot kaboom") });
		const client = new CamoufoxClient({ launcher });
		let first: unknown;
		try {
			await client.ensureReady();
		} catch (err) {
			first = err;
		}
		expect(first).toBeInstanceOf(CamoufoxErrorBox);
		const boxed = first as CamoufoxErrorBox;
		expect(boxed.err).toEqual({ type: "browser_launch_failed", stderr: "boot kaboom" });
		await expect(client.ensureReady()).rejects.toBeInstanceOf(CamoufoxErrorBox);
		expect(launcher.fake.launchCount).toBe(1);
	});

	it("aborted ensureReady signal rejects with aborted", async () => {
		const launcher = makeFakeLauncher({ launchDelayMs: 50 });
		const client = new CamoufoxClient({ launcher });
		const ctrl = new AbortController();
		const p = client.ensureReady(ctrl.signal);
		ctrl.abort();
		await expect(p).rejects.toMatchObject({ err: { type: "aborted" } });
	});
});
