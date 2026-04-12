import type { Page } from "playwright-core";

export interface RawResult {
	readonly title: string;
	readonly url: string;
	readonly snippet: string;
	readonly rank: number;
}

export interface SearchEngineAdapter {
	readonly name: "duckduckgo";
	buildUrl(query: string): string;
	readonly waitStrategy: { readyState: "domcontentloaded" | "load" | "networkidle" };
	parseResults(page: Page, maxResults: number): Promise<RawResult[]>;
}
