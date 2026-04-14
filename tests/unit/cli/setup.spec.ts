import { describe, expect, it, vi } from "vitest";

import { runSetup } from "../../../src/cli/setup.js";
import { redditAdapter } from "../../../src/sources/adapters/reddit.js";
import type { SourceAdapter } from "../../../src/sources/types.js";
import { createFakeCredentialBackend } from "../../helpers/fake-credential-backend.js";
import { makeFakeLauncher } from "../../helpers/fake-launcher.js";

describe("runSetup audit", () => {
	it("exits 0 when all sources are fully configured", async () => {
		const logs: string[] = [];
		const exit = await runSetup({
			mode: "full",
			adapters: [redditAdapter()],
			backend: createFakeCredentialBackend(),
			launcher: makeFakeLauncher({}),
			log: (l) => {
				logs.push(l);
			},
			promptLine: async () => "",
			promptSecret: async () => "",
		});
		expect(exit).toBe(0);
		expect(logs.join("\n")).toContain("reddit");
		expect(logs.join("\n")).toContain("ok");
	});

	it("reports missing credentials in audit", async () => {
		const logs: string[] = [];
		const fakeAdapter: SourceAdapter = {
			name: "fake-api",
			tier: 4,
			requiredCredentials: [
				{
					kind: "api_key",
					key: "api_key",
					description: "Test API key",
					obtainUrl: "https://example.test/get-key",
				},
			],
			fetch: async () => [],
		};
		const exit = await runSetup({
			mode: "check",
			adapters: [fakeAdapter],
			backend: createFakeCredentialBackend(),
			launcher: makeFakeLauncher({}),
			log: (l) => {
				logs.push(l);
			},
			promptLine: async () => "",
			promptSecret: async () => "",
		});
		expect(exit).not.toBe(0);
		expect(logs.join("\n")).toContain("missing");
	});

	it("prompts for missing api_key, stores, re-audits green", async () => {
		const logs: string[] = [];
		const backend = createFakeCredentialBackend();
		const fakeAdapter: SourceAdapter = {
			name: "fake-api",
			tier: 4,
			requiredCredentials: [
				{
					kind: "api_key",
					key: "api_key",
					description: "Test API key",
				},
			],
			fetch: async () => [],
		};
		const promptSecret = vi.fn(async () => "entered-value");
		const exit = await runSetup({
			mode: "full",
			adapters: [fakeAdapter],
			backend,
			launcher: makeFakeLauncher({}),
			log: (l) => {
				logs.push(l);
			},
			promptLine: async () => "",
			promptSecret,
		});
		expect(promptSecret).toHaveBeenCalled();
		expect(await backend.get("camoufox-pi:fake-api:api_key")).toBe("entered-value");
		expect(exit).toBe(0);
	});

	it("prints an explanatory message and exits 0 when no adapters are registered", async () => {
		const logs: string[] = [];
		const exit = await runSetup({
			mode: "full",
			adapters: [],
			backend: createFakeCredentialBackend(),
			launcher: makeFakeLauncher({}),
			log: (l) => {
				logs.push(l);
			},
			promptLine: async () => "",
			promptSecret: async () => "",
		});
		expect(exit).toBe(0);
		expect(logs.join("\n")).toContain("No source adapters are registered");
	});
});

describe("runSetup cookie_jar handling", () => {
	it("captures and stores cookie_jar credentials via the launcher", async () => {
		const adapters = [
			{
				name: "x",
				tier: 2 as const,
				requiredCredentials: [
					{
						kind: "cookie_jar" as const,
						key: "cookies",
						description: "X session cookies",
						loginUrl: "https://x.com/login",
					},
				],
				fetch: async () => [],
			},
		];
		const backend = createFakeCredentialBackend();
		const logs: string[] = [];

		const launcher = makeFakeLauncher({
			storageState: {
				cookies: [
					{
						name: "auth_token",
						value: "aaa",
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

		const code = await runSetup({
			mode: "full",
			adapters,
			backend,
			launcher,
			log: (l) => logs.push(l),
			promptLine: async () => "",
			promptSecret: async () => "",
		});

		expect(code).toBe(0);
		const stored = await backend.get("camoufox-pi:x:cookies");
		expect(stored).not.toBeNull();
		expect(JSON.parse(stored as string).cookies[0].name).toBe("auth_token");
	});
});
