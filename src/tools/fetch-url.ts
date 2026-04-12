import { Type } from "@sinclair/typebox";

import type { CamoufoxClient } from "../client/camoufox-client.js";
import "./formats.js";
import type { ToolDefinition } from "./types.js";

export const fetchUrlParams = Type.Object({
	url: Type.String({ format: "uri" }),
	timeout_ms: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 120_000 })),
});

export function createFetchUrlTool(client: CamoufoxClient): ToolDefinition<typeof fetchUrlParams> {
	return {
		name: "tff-fetch_url",
		readOnly: true,
		label: "Fetch URL",
		description:
			"Fetch a URL using a stealth Firefox browser and return its HTML. For sites that block Chromium-headed requests.",
		promptSnippet: "Fetch a page via Camoufox (stealth Firefox). Returns HTML.",
		promptGuidelines: [
			"Use this for pages behind Cloudflare, DataDome, Turnstile, or other bot walls.",
			"Returns the raw HTML of the final landing page. No markdown conversion in this release.",
			"timeout_ms is clamped between 1000 and 120000.",
		],
		parameters: fetchUrlParams,
		async execute(_toolCallId, input, signal) {
			const effectiveSignal = signal ?? new AbortController().signal;
			const { html, status, finalUrl } = await client.fetchUrl(input.url, {
				signal: effectiveSignal,
				...(input.timeout_ms !== undefined ? { timeoutMs: input.timeout_ms } : {}),
			});
			const bytes = Buffer.byteLength(html, "utf8");
			return {
				content: [
					{
						type: "text",
						text: `fetch_url ${input.url} → ${status} (${bytes} bytes)`,
					},
				],
				details: {
					url: input.url,
					finalUrl,
					status,
					html,
					bytes,
				},
			};
		},
	};
}
