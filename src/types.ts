// Domain types shared across the extension.
// Populated per docs/superpowers/specs/2026-04-12-foundational-slice-design.md §4.1.

export interface CamoufoxConfig {
	readonly timeoutMs: number;
	readonly defaultEngine: "duckduckgo";
}

export const DEFAULT_CONFIG: CamoufoxConfig = {
	timeoutMs: 30_000,
	defaultEngine: "duckduckgo",
};
