import { describe, expect, it, vi } from "vitest";

import { CamoufoxClient } from "../../src/client/camoufox-client.js";
import type { BinaryDownloadProgressEvent, BrowserLaunchEvent } from "../../src/client/events.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";

describe("CamoufoxClient — launch events", () => {
	it("emits browser_launch once after successful launch with a spanId", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		const seen: BrowserLaunchEvent[] = [];
		client.events.on("browser_launch", (e) => seen.push(e));
		await client.ensureReady();
		expect(seen).toHaveLength(1);
		expect(seen[0]?.browserVersion).toBe("fake-0.0.0");
		expect(seen[0]?.spanId).toMatch(/^[0-9a-f]{8}$/);
		expect(seen[0]?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("does not re-emit browser_launch on idempotent ensureReady", async () => {
		const launcher = makeFakeLauncher();
		const client = new CamoufoxClient({ launcher });
		const fn = vi.fn();
		client.events.on("browser_launch", fn);
		await client.ensureReady();
		await client.ensureReady();
		await client.ensureReady();
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("re-emits binary_download_progress events from the launcher in order", async () => {
		const events: BinaryDownloadProgressEvent[] = [
			{ bytesDownloaded: 10, bytesTotal: 100 },
			{ bytesDownloaded: 100, bytesTotal: 100 },
		];
		const launcher = makeFakeLauncher({ progressEvents: events });
		const client = new CamoufoxClient({ launcher });
		const seen: BinaryDownloadProgressEvent[] = [];
		client.events.on("binary_download_progress", (e) => seen.push(e));
		await client.ensureReady();
		expect(seen).toEqual(events);
	});

	it("emits error event before throw on launch failure", async () => {
		const boom = new Error("launch exploded");
		const launcher = makeFakeLauncher({ launchFails: boom });
		const client = new CamoufoxClient({ launcher });
		const errors: Array<{ op: string; type: string }> = [];
		client.events.on("error", (e) => errors.push({ op: e.op, type: e.error.type }));
		await expect(client.ensureReady()).rejects.toThrow();
		expect(errors).toEqual([{ op: "ensureReady", type: "browser_launch_failed" }]);
	});
});
