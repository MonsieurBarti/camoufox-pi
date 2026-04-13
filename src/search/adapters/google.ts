import type { Page } from "playwright-core";

import type { RawResult, SearchEngineAdapter } from "../types.js";

async function parseResults(page: Page, maxResults: number): Promise<RawResult[]> {
	const raw = await page.$$eval(
		"div#search div[data-sokoban-container]",
		(els, max) => {
			const out: { title: string; url: string; snippet: string }[] = [];
			const limit = Math.max(0, Math.min(50, Number(max) || 10));
			for (const el of els) {
				if (out.length >= limit) break;
				const h3 = el.querySelector("h3") as unknown as {
					textContent: string | null;
				} | null;
				const a = el.querySelector("a[jsname]") as unknown as {
					getAttribute(n: string): string | null;
				} | null;
				const snip =
					el.querySelector("div[data-sncf] span") ??
					el.querySelector('div[style*="-webkit-line-clamp"]');
				if (!h3 || !a) continue;
				const title = (h3.textContent ?? "").trim();
				const url = a.getAttribute("href") ?? "";
				if (!title || !url) continue;
				try {
					const u = new URL(url);
					if (u.protocol !== "http:" && u.protocol !== "https:") continue;
				} catch {
					continue;
				}
				const snippet = ((snip?.textContent ?? "") as string).trim();
				out.push({ title, url, snippet });
			}
			return out;
		},
		maxResults,
	);
	return raw.map((r, i) => ({ ...r, rank: i + 1 }));
}

export const googleAdapter: SearchEngineAdapter = {
	name: "google",
	buildUrl(query: string): string {
		return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
	},
	waitStrategy: { readyState: "domcontentloaded" },
	parseResults,
};
