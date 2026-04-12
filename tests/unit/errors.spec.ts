import { describe, expect, it } from "vitest";

import { CamoufoxErrorBox, mapPlaywrightError } from "../../src/errors.js";

describe("CamoufoxErrorBox", () => {
	it("wraps a CamoufoxError and is throwable", () => {
		const box = new CamoufoxErrorBox({ type: "aborted" });
		expect(box).toBeInstanceOf(Error);
		expect(box.name).toBe("CamoufoxError");
		expect(box.err).toEqual({ type: "aborted" });
		expect(box.message).toContain("aborted");
	});

	it("redacts query strings from .message but preserves them in .err", () => {
		const box = new CamoufoxErrorBox({
			type: "http",
			status: 500,
			url: "https://x.test/path?token=secret&u=bob",
		});
		// message is sanitized — no query string
		expect(box.message).not.toContain("secret");
		expect(box.message).not.toContain("token");
		expect(box.message).toContain("https://x.test/path");
		// .err retains the full payload for programmatic callers
		expect((box.err as { url: string }).url).toBe("https://x.test/path?token=secret&u=bob");
	});

	it("truncates long stderr in .message", () => {
		const long = "a".repeat(1000);
		const box = new CamoufoxErrorBox({ type: "browser_launch_failed", stderr: long });
		expect(box.message.length).toBeLessThan(1000);
		expect(box.message).toContain("…[1000 bytes]");
		// .err keeps full stderr
		expect((box.err as { stderr: string }).stderr).toBe(long);
	});
});

describe("mapPlaywrightError", () => {
	it("maps AbortError to aborted", () => {
		const err = Object.assign(new Error("aborted"), { name: "AbortError" });
		expect(mapPlaywrightError(err, { url: "https://x.test", phase: "nav" })).toEqual({
			type: "aborted",
		});
	});

	it("maps aborted signal to aborted", () => {
		const signal = AbortSignal.abort();
		expect(mapPlaywrightError(new Error("anything"), { url: "https://x.test", signal })).toEqual({
			type: "aborted",
		});
	});

	it("maps Playwright TimeoutError to timeout", () => {
		const err = Object.assign(new Error("Timeout 30000ms exceeded"), { name: "TimeoutError" });
		expect(
			mapPlaywrightError(err, { url: "https://x.test", phase: "nav", elapsedMs: 30_000 }),
		).toEqual({ type: "timeout", phase: "nav", elapsedMs: 30_000 });
	});

	it("classifies TimeoutError as timeout even when signal.aborted is true", () => {
		// Combined-signal scenario: internal timeout fires, both abort AND
		// TimeoutError are seen. TimeoutError must win.
		const err = Object.assign(new Error("Timeout 30000ms exceeded"), { name: "TimeoutError" });
		const signal = AbortSignal.abort();
		expect(
			mapPlaywrightError(err, { url: "https://x.test", phase: "nav", elapsedMs: 30_000, signal }),
		).toEqual({ type: "timeout", phase: "nav", elapsedMs: 30_000 });
	});

	it("maps net::ERR_* to network", () => {
		const err = new Error("net::ERR_NAME_NOT_RESOLVED at https://x.test");
		expect(mapPlaywrightError(err, { url: "https://x.test", phase: "nav" })).toEqual({
			type: "network",
			cause: "net::ERR_NAME_NOT_RESOLVED at https://x.test",
			url: "https://x.test",
		});
	});

	it("maps NS_ERROR_NET_* to network", () => {
		const err = new Error("NS_ERROR_NET_RESET");
		expect(mapPlaywrightError(err, { url: "https://x.test", phase: "nav" })).toEqual({
			type: "network",
			cause: "NS_ERROR_NET_RESET",
			url: "https://x.test",
		});
	});

	it("maps getaddrinfo errors to network", () => {
		const err = new Error("getaddrinfo ENOTFOUND nowhere.test");
		expect(mapPlaywrightError(err, { url: "https://nowhere.test", phase: "nav" })).toEqual({
			type: "network",
			cause: "getaddrinfo ENOTFOUND nowhere.test",
			url: "https://nowhere.test",
		});
	});

	it("classifies unknown Errors as browser_launch_failed", () => {
		const err = new Error("totally unexpected");
		expect(mapPlaywrightError(err, { url: "https://x.test", phase: "nav" })).toEqual({
			type: "browser_launch_failed",
			stderr: "totally unexpected",
		});
	});

	it("wraps non-Error throwables as browser_launch_failed", () => {
		expect(mapPlaywrightError("string error", { url: "https://x.test", phase: "nav" })).toEqual({
			type: "browser_launch_failed",
			stderr: "string error",
		});
	});
});
