import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";

import { createHttpFetch } from "../../src/client/http-fetch.js";
import { CamoufoxErrorBox } from "../../src/errors.js";
import type { LookupFn } from "../../src/security/ssrf.js";

describe("httpFetch — scheme allow-list", () => {
	it("rejects file:// URLs with ssrf_blocked", async () => {
		const httpFetch = createHttpFetch({});
		await expect(httpFetch("file:///etc/passwd")).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "initial" },
		});
	});

	it("rejects javascript: URLs", async () => {
		const httpFetch = createHttpFetch({});
		await expect(httpFetch("javascript:alert(1)")).rejects.toBeInstanceOf(CamoufoxErrorBox);
	});

	it("rejects data: URLs", async () => {
		const httpFetch = createHttpFetch({});
		await expect(httpFetch("data:text/plain,hi")).rejects.toBeInstanceOf(CamoufoxErrorBox);
	});
});

describe("httpFetch — SSRF", () => {
	it("blocks 127.0.0.1 with ssrf_blocked", async () => {
		const httpFetch = createHttpFetch({});
		await expect(httpFetch("http://127.0.0.1/")).rejects.toMatchObject({
			err: { type: "ssrf_blocked", hop: "initial" },
		});
	});

	it("blocks hostnames resolving to private IPs", async () => {
		const httpFetch = createHttpFetch({
			lookup: (async () =>
				[{ address: "10.0.0.5", family: 4 }] as unknown as LookupAddress[]) as unknown as LookupFn,
		});
		await expect(httpFetch("http://evil.test/")).rejects.toMatchObject({
			err: { type: "ssrf_blocked" },
		});
	});
});
