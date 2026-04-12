// Helpers for CamoufoxClient.fetchUrl — wait-strategy resolution, selector
// waits, DOM slicing, HTML→markdown, screenshot capture. Split out so fetchUrl
// reads as a recipe and htmlToMarkdown can be tested without a browser.
// Spec: docs/superpowers/specs/2026-04-13-fetch-url-features-design.md §3.1.

import TurndownService from "turndown";

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

// Pre-strips elements that should never appear in a markdown extraction:
// scripts, styles, noscript, svg, iframes, HTML comments. Regex-based so it
// works on raw HTML strings without needing a DOM parser roundtrip.
function stripDangerousBlocks(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<(script|style|noscript|svg|iframe)\b[^>]*\/>/gi, "");
}

// Turndown does not resolve relative URLs. We do it on the raw HTML before
// converting so every [text](url) and ![alt](url) in the output is absolute
// against the page's final URL.
function absolutizeUrls(html: string, baseUrl: string): string {
	return html.replace(
		/(\s(?:href|src))\s*=\s*(["'])([^"']*)\2/gi,
		(match, attr: string, quote: string, value: string) => {
			try {
				const abs = new URL(value, baseUrl).href;
				return `${attr}=${quote}${abs}${quote}`;
			} catch {
				return match;
			}
		},
	);
}

export function htmlToMarkdown(html: string, baseUrl: string): string {
	if (html === "") return "";
	const cleaned = absolutizeUrls(stripDangerousBlocks(html), baseUrl);
	const td = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});
	try {
		return td.turndown(cleaned);
	} catch {
		// Turndown should not throw on reasonable input; if it does, fall back
		// to raw stripped HTML so the caller still gets something usable. The
		// client layer wraps this in config_invalid if empty isn't acceptable.
		return cleaned;
	}
}
