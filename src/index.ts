import type { TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import type { CommandContext, CommandDefinition } from "./commands/index.js";
import { createAllCommands } from "./commands/index.js";
import { createAllHooks } from "./hooks/index.js";
import { CamoufoxService } from "./services/camoufox-service.js";
import type { ToolDefinition } from "./tools/index.js";
import { createAllTools } from "./tools/index.js";
import { checkForUpdates } from "./update-check.js";

// ---------------------------------------------------------------------------
// Library-style named exports. Let other PI extensions (e.g. TFF) import
// CamoufoxService and factories directly instead of spawning a child `pi`
// process. The default export (camoufoxExtension) remains the canonical
// PI-extension entry.
// ---------------------------------------------------------------------------

export { CamoufoxService } from "./services/camoufox-service.js";
export { createAllTools } from "./tools/index.js";
export { createAllCommands } from "./commands/index.js";
export { createAllHooks } from "./hooks/index.js";

export type { ToolDefinition } from "./tools/index.js";
export type { CommandDefinition, CommandContext } from "./commands/index.js";
export type { HookDefinition } from "./hooks/index.js";
export type { CamoufoxConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Structural PI API — minimal subset of what @mariozechner/pi-coding-agent
// exposes at runtime. We deliberately avoid importing the real type so this
// package can be imported and unit-tested without the peer dep installed.
// ---------------------------------------------------------------------------

type PiEventHandler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

interface PiToolExecuteResult {
	content: Array<{ type: "text"; text: string }>;
	details: unknown;
}

interface PiRegisteredTool {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	parameters: unknown;
	execute(toolCallId: string, input: unknown): Promise<PiToolExecuteResult>;
}

interface PiRegisteredCommand {
	description?: string | undefined;
	handler(args: string, ctx: PiCommandContext): Promise<void>;
}

interface PiCommandContext {
	ui?: {
		notify?: (message: string, level?: string) => void;
	};
	cwd?: string;
}

export interface PiExtensionApi {
	on(event: string, handler: PiEventHandler): void;
	registerTool(tool: PiRegisteredTool): void;
	registerCommand(name: string, config: PiRegisteredCommand): void;
	exec: (
		cmd: string,
		args: string[],
		opts?: { timeout?: number },
	) => Promise<{ stdout: string; code: number }>;
	cwd?: string;
}

// ---------------------------------------------------------------------------
// Boundary adapters: bridge tool/command definitions to PI's structural shape
// without casts. `wrapTool` uses TypeBox's runtime Value.Check to narrow the
// unknown input to Static<S> before delegating to the typed execute().
// ---------------------------------------------------------------------------

function wrapTool<S extends TObject>(def: ToolDefinition<S>): PiRegisteredTool {
	const guidelines = [...def.promptGuidelines];
	if (def.readOnly) {
		guidelines.push(
			"This tool is read-only (no side effects). Safe to call in parallel with other read-only tools.",
		);
	}
	return {
		name: def.name,
		label: def.label,
		description: def.description,
		promptSnippet: def.promptSnippet,
		promptGuidelines: guidelines,
		parameters: def.parameters,
		async execute(toolCallId, input) {
			if (!Value.Check(def.parameters, input)) {
				return {
					content: [
						{
							type: "text",
							text: `Invalid input for ${def.name}`,
						},
					],
					details: { error: "validation-failed" },
				};
			}
			const result = await def.execute(toolCallId, input);
			return {
				content: result.content,
				details: result.details,
			};
		},
	};
}

function wrapCommand(def: CommandDefinition): PiRegisteredCommand {
	return {
		description: def.description,
		async handler(args, piCtx) {
			const ctx: CommandContext = {
				cwd: piCtx.cwd ?? process.cwd(),
				ui: {
					notify: (message, level = "info") => {
						piCtx.ui?.notify?.(message, level);
					},
				},
			};
			await def.handler(args, ctx);
		},
	};
}

// ---------------------------------------------------------------------------
// Default export — called by PI with its ExtensionAPI instance at startup.
// ---------------------------------------------------------------------------

export default function camoufoxExtension(pi: PiExtensionApi): void {
	const service = new CamoufoxService();

	// Register all tools + commands.
	for (const def of createAllTools(service)) {
		pi.registerTool(wrapTool(def));
	}
	for (const def of createAllCommands(service)) {
		pi.registerCommand(def.name, wrapCommand(def));
	}

	// Register hooks.
	for (const hook of createAllHooks(service)) {
		pi.on(hook.event, hook.handler);
	}

	// Lifecycle: initialize on session_start, cleanup on session_shutdown.
	pi.on("session_start", async (_event, ctx) => {
		const cwd = (ctx as { cwd?: string })?.cwd ?? pi.cwd ?? process.cwd();
		await service.initialize(cwd);

		// Check for extension updates
		const updateInfo = await checkForUpdates(pi);
		if (updateInfo?.updateAvailable) {
			(ctx as { ui?: { notify?: (message: string, level?: string) => void } }).ui?.notify?.(
				`📦 Update available: ${updateInfo.latestVersion} (you have ${updateInfo.currentVersion}). Run: pi install npm:@the-forge-flow/camoufox-pi`,
				"info",
			);
		}
	});

	pi.on("session_shutdown", async () => {
		await service.shutdown();
	});
}
