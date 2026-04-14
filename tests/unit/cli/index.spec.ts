import { describe, expect, it } from "vitest";

import { runCli } from "../../../src/cli/index.js";

describe("runCli --refresh", () => {
	it("dispatches setup:refresh when --refresh <source> is passed", async () => {
		const calls: string[] = [];
		const code = await runCli(["setup", "--refresh", "x"], {
			handlers: {
				"setup:refresh:x": async () => {
					calls.push("refresh-x");
					return 0;
				},
				setup: async () => {
					calls.push("full");
					return 0;
				},
				"setup:check": async () => {
					calls.push("check");
					return 0;
				},
			},
			log: () => {},
		});
		expect(code).toBe(0);
		expect(calls).toEqual(["refresh-x"]);
	});

	it("returns exit 2 with mutual-exclusion when --check and --refresh both present", async () => {
		const logs: string[] = [];
		const code = await runCli(["setup", "--check", "--refresh", "x"], {
			handlers: {},
			log: (l) => logs.push(l),
		});
		expect(code).toBe(2);
		expect(logs.join("\n")).toMatch(/mutually exclusive/);
	});

	it("returns exit 2 when --refresh is given without a source argument", async () => {
		const logs: string[] = [];
		const code = await runCli(["setup", "--refresh"], {
			handlers: {},
			log: (l) => logs.push(l),
		});
		expect(code).toBe(2);
		expect(logs.join("\n")).toMatch(/--refresh requires a source/);
	});
});
