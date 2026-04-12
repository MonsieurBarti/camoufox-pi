import "../../src/tools/formats.js";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { CamoufoxErrorBox } from "../../src/errors.js";
import camoufoxExtension, {
	CamoufoxService,
	createAllCommands,
	createAllHooks,
} from "../../src/index.js";
import type { ToolDefinition } from "../../src/tools/types.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";

describe("library exports", () => {
	it("exposes the default extension entry", () => {
		expect(typeof camoufoxExtension).toBe("function");
	});

	it("exposes the service and factories with an eagerly-constructed client", () => {
		const service = new CamoufoxService({ launcher: makeFakeLauncher() });
		expect(typeof service.getConfig).toBe("function");
		expect(createAllCommands(service)).toEqual([]);
		expect(createAllHooks(service)).toEqual([]);
		expect(service.getClient()).toBeDefined();
	});
});

describe("wrapTool boundary", () => {
	it("throws CamoufoxErrorBox on invalid input and threads the signal on valid", async () => {
		const schema = Type.Object({ url: Type.String({ format: "uri" }) });
		const toolDef: ToolDefinition<typeof schema> = {
			name: "test-tool",
			label: "test",
			description: "test",
			promptSnippet: "",
			promptGuidelines: [],
			parameters: schema,
			async execute(_id, input, signal) {
				return {
					content: [{ type: "text", text: "ok" }],
					details: {
						url: input.url,
						aborted: signal?.aborted ?? false,
					},
				};
			},
		};

		const { __test_wrapTool__ } = await import("../../src/index.js");
		const w = __test_wrapTool__(toolDef);

		await expect(w.execute("id", { url: "not-a-url" }, undefined)).rejects.toBeInstanceOf(
			CamoufoxErrorBox,
		);

		const ctrl = new AbortController();
		const res = await w.execute("id", { url: "https://ok.test/" }, ctrl.signal);
		expect(res.details).toMatchObject({ url: "https://ok.test/" });
	});
});
