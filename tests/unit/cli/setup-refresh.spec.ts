import { describe, expect, it } from "vitest";
import { runSetup } from "../../../src/cli/setup.js";
import type { SourceAdapter } from "../../../src/sources/types.js";
import { createFakeCredentialBackend } from "../../helpers/fake-credential-backend.js";
import { makeFakeLauncher } from "../../helpers/fake-launcher.js";

function xLikeAdapter(): SourceAdapter {
	return {
		name: "x",
		tier: 2,
		requiredCredentials: [
			{
				kind: "cookie_jar",
				key: "cookies",
				description: "X session",
				loginUrl: "https://x.com/login",
			},
		],
		fetch: async () => [],
	};
}

describe("runSetup --refresh", () => {
	it("deletes the existing cookie_jar credential and re-captures", async () => {
		const backend = createFakeCredentialBackend();
		await backend.set("camoufox-pi:x:cookies", JSON.stringify({ cookies: [], origins: [] }));
		const ops: string[] = [];
		const wrapped = {
			...backend,
			delete: async (k: string) => {
				ops.push(`del:${k}`);
				return backend.delete(k);
			},
			set: async (k: string, v: string) => {
				ops.push(`set:${k}`);
				return backend.set(k, v);
			},
		};
		const launcher = makeFakeLauncher({
			storageState: {
				cookies: [
					{
						name: "auth_token",
						value: "NEW",
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
			refreshSource: "x",
			adapters: [xLikeAdapter()],
			backend: wrapped,
			launcher,
			log: () => {},
			promptLine: async () => "",
			promptSecret: async () => "",
		});

		expect(code).toBe(0);
		expect(ops[0]).toBe("del:camoufox-pi:x:cookies");
		expect(ops[1]).toBe("set:camoufox-pi:x:cookies");
		const stored = await backend.get("camoufox-pi:x:cookies");
		expect(JSON.parse(stored as string).cookies[0].value).toBe("NEW");
	});

	it("exits 2 when the source is not registered", async () => {
		const backend = createFakeCredentialBackend();
		const logs: string[] = [];
		const code = await runSetup({
			mode: "full",
			refreshSource: "bogus",
			adapters: [xLikeAdapter()],
			backend,
			launcher: makeFakeLauncher({}),
			log: (l) => logs.push(l),
			promptLine: async () => "",
			promptSecret: async () => "",
		});
		expect(code).toBe(2);
		expect(logs.join("\n")).toMatch(/unknown source: bogus/);
	});

	it("skips non-cookie_jar creds with a skip message", async () => {
		const adapter: SourceAdapter = {
			name: "sc",
			tier: 4,
			requiredCredentials: [{ kind: "api_key", key: "key", description: "" }],
			fetch: async () => [],
		};
		const logs: string[] = [];
		const backend = createFakeCredentialBackend();
		await backend.set("camoufox-pi:sc:key", "existing");
		const code = await runSetup({
			mode: "full",
			refreshSource: "sc",
			adapters: [adapter],
			backend,
			launcher: makeFakeLauncher({}),
			log: (l) => logs.push(l),
			promptLine: async () => "",
			promptSecret: async () => "",
		});
		expect(code).toBe(0);
		expect(logs.join("\n")).toMatch(/skip key — use setup/);
	});
});
