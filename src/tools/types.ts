import type { Static, TObject } from "@sinclair/typebox";

// Structural ToolDefinition compatible with @mariozechner/pi-coding-agent's
// ExtensionAPI.registerTool signature. Defined locally so tool files and their
// tests do not need to import from the peer dep. Each tool narrows
// `parameters` to its own TypeBox schema via a generic.
export interface ToolDefinition<S extends TObject = TObject> {
	name: string;
	readOnly?: boolean;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	parameters: S;
	execute(toolCallId: string, input: Static<S>): Promise<ToolExecuteResult>;
}

export interface ToolExecuteResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, ToolDetailValue>;
}

// Recursive JSON-safe value type for the `details` field on a tool result.
export type ToolDetailValue =
	| string
	| number
	| boolean
	| null
	| ToolDetailValue[]
	| { [key: string]: ToolDetailValue };
