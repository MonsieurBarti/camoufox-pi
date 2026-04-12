import { describe, expect, it, vi } from "vitest";

import {
	type BinaryDownloadProgressEvent,
	type BrowserLaunchEvent,
	type CamoufoxEventEmitter,
	type ErrorEvent,
	type FetchUrlEvent,
	type SearchEvent,
	createEventEmitter,
	newSpanId,
} from "../../src/client/events.js";

describe("newSpanId", () => {
	it("returns an 8-char string", () => {
		const id = newSpanId();
		expect(id).toMatch(/^[0-9a-f]{8}$/);
	});

	it("returns distinct values across calls", () => {
		const a = newSpanId();
		const b = newSpanId();
		expect(a).not.toBe(b);
	});
});

describe("CamoufoxEventEmitter", () => {
	it("delivers only to listeners of the same event", () => {
		const ee: CamoufoxEventEmitter = createEventEmitter();
		const onSearch = vi.fn();
		const onFetch = vi.fn();
		ee.on("search", onSearch);
		ee.on("fetch_url", onFetch);
		const payload: SearchEvent = {
			spanId: "aaaaaaaa",
			engine: "duckduckgo",
			query: "q",
			maxResults: 10,
			durationMs: 1,
			resultCount: 0,
			atLimit: false,
		};
		ee.emit("search", payload);
		expect(onSearch).toHaveBeenCalledWith(payload);
		expect(onFetch).not.toHaveBeenCalled();
	});

	it("supports off() to remove listeners", () => {
		const ee = createEventEmitter();
		const fn = vi.fn();
		ee.on("error", fn);
		ee.off("error", fn);
		const payload: ErrorEvent = {
			spanId: "bbbbbbbb",
			op: "fetchUrl",
			error: { type: "aborted" },
		};
		ee.emit("error", payload);
		expect(fn).not.toHaveBeenCalled();
	});

	it("once() fires at most one time", () => {
		const ee = createEventEmitter();
		const fn = vi.fn();
		ee.once("browser_launch", fn);
		const payload: BrowserLaunchEvent = {
			spanId: "cccccccc",
			browserVersion: "fake-0",
			durationMs: 0,
		};
		ee.emit("browser_launch", payload);
		ee.emit("browser_launch", payload);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("isolates thrown listener errors and continues to other listeners", () => {
		const ee = createEventEmitter();
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const throwing = vi.fn(() => {
			throw new Error("boom");
		});
		const ok = vi.fn();
		ee.on("fetch_url", throwing);
		ee.on("fetch_url", ok);
		const payload: FetchUrlEvent = {
			spanId: "dddddddd",
			url: "https://x.test/",
			finalUrl: "https://x.test/",
			status: 200,
			bytes: 0,
			truncated: false,
			isolate: false,
			durationMs: 1,
		};
		expect(() => ee.emit("fetch_url", payload)).not.toThrow();
		expect(throwing).toHaveBeenCalled();
		expect(ok).toHaveBeenCalled();
		expect(errSpy).toHaveBeenCalled();
		errSpy.mockRestore();
	});

	it("listenerCount reflects registered listeners", () => {
		const ee = createEventEmitter();
		expect(ee.listenerCount("binary_download_progress")).toBe(0);
		ee.on("binary_download_progress", () => undefined);
		ee.on("binary_download_progress", () => undefined);
		expect(ee.listenerCount("binary_download_progress")).toBe(2);
	});

	it("payload types compile with all 5 event names (structural)", () => {
		const ee = createEventEmitter();
		const bdp: BinaryDownloadProgressEvent = { bytesDownloaded: 0, bytesTotal: null };
		ee.emit("binary_download_progress", bdp);
		expect(true).toBe(true);
	});
});
