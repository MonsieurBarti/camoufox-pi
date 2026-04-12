import { describe, expect, it } from "vitest";

import camoufoxExtension, {
	CamoufoxService,
	createAllCommands,
	createAllHooks,
	createAllTools,
} from "../../src/index.js";

describe("library exports", () => {
	it("exposes the default extension entry", () => {
		expect(typeof camoufoxExtension).toBe("function");
	});

	it("exposes the service and factories", () => {
		const service = new CamoufoxService();
		expect(createAllTools(service)).toEqual([]);
		expect(createAllCommands(service)).toEqual([]);
		expect(createAllHooks(service)).toEqual([]);
	});
});
