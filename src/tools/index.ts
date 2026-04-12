import type { CamoufoxService } from "../services/camoufox-service.js";
import type { ToolDefinition } from "./types.js";

export type { ToolDefinition, ToolDetailValue, ToolExecuteResult } from "./types.js";

export function createAllTools(_service: CamoufoxService): ToolDefinition[] {
	return [];
}
