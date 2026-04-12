// Helpers for CamoufoxClient.fetchUrl — wait-strategy resolution, selector
// waits, DOM slicing, HTML→markdown, screenshot capture. Split out so fetchUrl
// reads as a recipe and htmlToMarkdown can be tested without a browser.
// Spec: docs/superpowers/specs/2026-04-13-fetch-url-features-design.md §3.1.

export type RenderMode = "static" | "render" | "render-and-wait";
export type Format = "html" | "markdown";

export function resolveWaitUntil(mode: RenderMode): "domcontentloaded" | "load" | "networkidle" {
	switch (mode) {
		case "static":
			return "domcontentloaded";
		case "render":
			return "load";
		case "render-and-wait":
			return "networkidle";
	}
}
