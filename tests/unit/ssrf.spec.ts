import { describe, expect, it } from "vitest";

import { type LookupFn, assertSafeTarget } from "../../src/security/ssrf.js";

describe("assertSafeTarget — literal IPs", () => {
	it("allows public IPv4 literals", async () => {
		await expect(assertSafeTarget("https://1.1.1.1/")).resolves.toBeUndefined();
		await expect(assertSafeTarget("https://8.8.8.8/")).resolves.toBeUndefined();
	});

	it("allows public IPv6 literals", async () => {
		await expect(assertSafeTarget("https://[2001:4860:4860::8888]/")).resolves.toBeUndefined();
	});

	it("rejects IPv4 loopback", async () => {
		await expect(assertSafeTarget("http://127.0.0.1/")).rejects.toThrow(/private IPv4/);
	});

	it("rejects IPv4 RFC1918", async () => {
		await expect(assertSafeTarget("http://10.0.0.1/")).rejects.toThrow(/private IPv4/);
		await expect(assertSafeTarget("http://192.168.1.1/")).rejects.toThrow(/private IPv4/);
		await expect(assertSafeTarget("http://172.16.0.1/")).rejects.toThrow(/private IPv4/);
	});

	it("rejects AWS/GCP metadata endpoint", async () => {
		await expect(assertSafeTarget("http://169.254.169.254/")).rejects.toThrow(/private IPv4/);
	});

	it("rejects 0.0.0.0/8", async () => {
		await expect(assertSafeTarget("http://0.0.0.0/")).rejects.toThrow(/private IPv4/);
	});

	it("rejects IPv6 loopback", async () => {
		await expect(assertSafeTarget("http://[::1]/")).rejects.toThrow(/private IPv6/);
	});

	it("rejects IPv6 link-local", async () => {
		await expect(assertSafeTarget("http://[fe80::1]/")).rejects.toThrow(/private IPv6/);
	});

	it("rejects IPv6 unique-local", async () => {
		await expect(assertSafeTarget("http://[fc00::1]/")).rejects.toThrow(/private IPv6/);
	});
});

describe("assertSafeTarget — DNS lookup", () => {
	it("allows hostnames that resolve to public IPv4", async () => {
		const lookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as LookupFn;
		await expect(assertSafeTarget("https://example.com/", { lookup })).resolves.toBeUndefined();
	});

	it("rejects hostnames that resolve to private IPv4", async () => {
		const lookup = (async () => [{ address: "127.0.0.1", family: 4 }]) as unknown as LookupFn;
		await expect(assertSafeTarget("https://localhost-alias.test/", { lookup })).rejects.toThrow(
			/resolves to private IPv4/,
		);
	});

	it("rejects hostnames that resolve to private IPv6", async () => {
		const lookup = (async () => [{ address: "::1", family: 6 }]) as unknown as LookupFn;
		await expect(assertSafeTarget("https://localhost6-alias.test/", { lookup })).rejects.toThrow(
			/resolves to private IPv6/,
		);
	});

	it("rejects if DNS resolution fails", async () => {
		const lookup = (async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as LookupFn;
		await expect(assertSafeTarget("https://doesnotexist.invalid/", { lookup })).rejects.toThrow(
			/cannot resolve/,
		);
	});

	it("rejects if ANY resolved address is private (multi-address)", async () => {
		const lookup = (async () => [
			{ address: "93.184.216.34", family: 4 },
			{ address: "10.0.0.1", family: 4 },
		]) as unknown as LookupFn;
		await expect(assertSafeTarget("https://mixed.test/", { lookup })).rejects.toThrow(
			/private IPv4/,
		);
	});
});
