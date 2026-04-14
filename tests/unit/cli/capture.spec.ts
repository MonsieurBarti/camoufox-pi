import { describe, expect, it } from "vitest";
import { captureCookieJar } from "../../../src/cli/capture.js";
import { makeFakeLauncher } from "../../helpers/fake-launcher.js";

describe("captureCookieJar — Enter wins", () => {
	it("serializes storageState when the user presses Enter", async () => {
		const launcher = makeFakeLauncher({
			storageState: {
				cookies: [
					{
						name: "auth_token",
						value: "abc",
						domain: ".x.com",
						path: "/",
						expires: -1,
						httpOnly: true,
						secure: true,
						sameSite: "Lax",
					},
				],
				origins: [],
			},
		});
		const log: string[] = [];
		const result = await captureCookieJar({
			source: "x",
			loginUrl: "https://x.com/login",
			launcher,
			log: (l) => log.push(l),
			promptLine: async () => "",
		});
		expect(JSON.parse(result.storageStateJson)).toEqual({
			cookies: [expect.objectContaining({ name: "auth_token", value: "abc" })],
			origins: [],
		});
		expect(log.join("\n")).toContain("https://x.com/login");
	});
});

describe("captureCookieJar — URL watcher wins", () => {
	it("resolves when loggedInUrlPattern matches before Enter is pressed", async () => {
		const launcher = makeFakeLauncher({
			storageState: {
				cookies: [
					{
						name: "ct0",
						value: "xxx",
						domain: ".x.com",
						path: "/",
						expires: -1,
						httpOnly: false,
						secure: true,
						sameSite: "Lax",
					},
				],
				origins: [],
			},
		});
		// Prompt resolves never (so URL watcher must win).
		let enterResolve: ((v: string) => void) | undefined;
		const promptPromise = new Promise<string>((r) => {
			enterResolve = r;
		});

		const launched = await launcher.launch();
		// Relaunch via the real capture path — we need the context to drive URL.
		const capturePromise = captureCookieJar({
			source: "x",
			loginUrl: "https://x.com/login",
			loggedInUrlPattern: /^https:\/\/x\.com\/home/,
			launcher: { launch: async () => launched },
			log: () => {},
			promptLine: () => promptPromise,
		});

		// Wait for page.goto() to complete so waitForURL is registered before we
		// flip the URL. This is deterministic — no setImmediate timing hack needed.
		await (launched.context as unknown as { __pageReady(): Promise<void> }).__pageReady();
		(launched.context as unknown as { __setPageUrl(u: string): void }).__setPageUrl(
			"https://x.com/home",
		);

		const result = await capturePromise;
		expect(JSON.parse(result.storageStateJson).cookies[0].name).toBe("ct0");
		// Cleanup the dangling prompt.
		enterResolve?.("");
	});
});

describe("captureCookieJar — failure races", () => {
	it("rejects when the user closes the browser before capture", async () => {
		const launcher = makeFakeLauncher({});
		const launched = await launcher.launch();
		const promise = captureCookieJar({
			source: "x",
			loginUrl: "https://x.com/login",
			launcher: { launch: async () => launched },
			log: () => {},
			promptLine: () => new Promise(() => {}),
		});
		await new Promise((resolve) => {
			setImmediate(() => {
				launched.context.close();
				resolve(undefined);
			});
		});
		await expect(promise).rejects.toThrow(/browser closed/);
	});

	it("rejects when the abort signal fires", async () => {
		const launcher = makeFakeLauncher({});
		const ac = new AbortController();
		const promise = captureCookieJar({
			source: "x",
			loginUrl: "https://x.com/login",
			launcher,
			log: () => {},
			promptLine: () => new Promise(() => {}),
			signal: ac.signal,
		});
		ac.abort();
		await expect(promise).rejects.toThrow(/aborted/);
	});

	it("rejects immediately if the signal is already aborted", async () => {
		const launcher = makeFakeLauncher({});
		const ac = new AbortController();
		ac.abort();
		await expect(
			captureCookieJar({
				source: "x",
				loginUrl: "https://x.com/login",
				launcher,
				log: () => {},
				promptLine: () => new Promise(() => {}),
				signal: ac.signal,
			}),
		).rejects.toThrow(/aborted/);
	});
});
