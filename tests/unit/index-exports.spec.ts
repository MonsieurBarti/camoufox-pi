import { describe, expect, it } from "vitest";

describe("public exports", () => {
	it("re-exports xAdapter", async () => {
		const mod = await import("../../src/index.js");
		expect(typeof mod.xAdapter).toBe("function");
		const a = mod.xAdapter();
		expect(a.name).toBe("x");
	});
});
