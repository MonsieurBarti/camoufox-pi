// Minimal fake of the Launcher + Playwright surface CamoufoxClient touches.
// Kept deliberately small: navigate() only uses goto, content, url, $$eval,
// close. Extend this file when new surface is added in future slices.

import type { Browser, BrowserContext, Page, Response } from "playwright-core";

import type { LaunchedBrowser, Launcher } from "../../src/client/launcher.js";

export interface FakePageResponse {
	status?: number;
	finalUrl?: string;
	html?: string;
	/** If provided, goto() throws this error instead of returning a response. */
	gotoError?: Error;
	/** If true, fake a null response from goto (rare but possible). */
	nullResponse?: boolean;
	/** Delay in ms before goto resolves, simulated via setTimeout. */
	gotoDelayMs?: number;
	/**
	 * Optional DOM data queried via page.$$eval (used by adapters).
	 * Keyed by selector; value is whatever the evaluator returns.
	 */
	evalResults?: Record<string, unknown>;
}

export interface FakeControls {
	pagesOpened: number;
	pagesClosed: number;
	launchCount: number;
	connected: boolean;
	setConnected(value: boolean): void;
}

export interface FakeLauncherOptions {
	pageBehavior?: (url: string) => FakePageResponse;
	launchDelayMs?: number;
	launchFails?: Error;
}

export function makeFakeLauncher(
	opts: FakeLauncherOptions = {},
): Launcher & { readonly fake: FakeControls } {
	const controls: FakeControls = {
		pagesOpened: 0,
		pagesClosed: 0,
		launchCount: 0,
		connected: true,
		setConnected(value: boolean) {
			controls.connected = value;
		},
	};

	const pageBehavior: (url: string) => FakePageResponse =
		opts.pageBehavior ?? ((): FakePageResponse => ({ status: 200, html: "<html></html>" }));

	const makePage = (): Page => {
		controls.pagesOpened += 1;
		let closed = false;
		let currentUrl = "";
		const page = {
			async goto(
				url: string,
				_options?: { timeout?: number; waitUntil?: string },
			): Promise<Response | null> {
				const behavior = pageBehavior(url);
				if (behavior.gotoDelayMs && behavior.gotoDelayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, behavior.gotoDelayMs));
				}
				if (behavior.gotoError) throw behavior.gotoError;
				if (behavior.nullResponse) return null;
				currentUrl = behavior.finalUrl ?? url;
				return {
					status: () => behavior.status ?? 200,
					url: () => behavior.finalUrl ?? url,
				} as unknown as Response;
			},
			async content(): Promise<string> {
				const behavior = pageBehavior(currentUrl);
				return behavior.html ?? "<html></html>";
			},
			url(): string {
				return currentUrl;
			},
			async $$eval<T>(
				selector: string,
				evaluator: (els: unknown[], ...args: unknown[]) => T,
				...args: unknown[]
			): Promise<T> {
				const behavior = pageBehavior(currentUrl);
				const results = behavior.evalResults;
				if (results && selector in results) {
					const value = results[selector];
					// If the value is an array of plain objects (no querySelector prop),
					// assume it's the already-parsed output and skip the evaluator.
					if (
						Array.isArray(value) &&
						value.every(
							(v) => v !== null && typeof v === "object" && !("querySelector" in (v as object)),
						)
					) {
						return value as unknown as T;
					}
					return evaluator(value as unknown[], ...args);
				}
				return [] as unknown as T;
			},
			async close(): Promise<void> {
				if (!closed) {
					closed = true;
					controls.pagesClosed += 1;
				}
			},
			isClosed(): boolean {
				return closed;
			},
		} as unknown as Page;
		return page;
	};

	const context = {
		async newPage(): Promise<Page> {
			return makePage();
		},
		async close(): Promise<void> {},
	} as unknown as BrowserContext;

	const browser = {
		isConnected(): boolean {
			return controls.connected;
		},
		async close(): Promise<void> {
			controls.connected = false;
		},
	} as unknown as Browser;

	return {
		fake: controls,
		async launch(_signal?: AbortSignal): Promise<LaunchedBrowser> {
			controls.launchCount += 1;
			if (opts.launchDelayMs && opts.launchDelayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, opts.launchDelayMs));
			}
			if (opts.launchFails) throw opts.launchFails;
			return { browser, context, version: "fake-0.0.0" };
		},
	};
}
