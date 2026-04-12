// Minimal fake of the Launcher + Playwright surface CamoufoxClient touches.
// Kept deliberately small: navigate() only uses goto, content, url, $$eval,
// close. Extend this file when new surface is added in future slices.

import type { Browser, BrowserContext, Page, Response } from "playwright-core";

import type { BinaryDownloadProgressEvent } from "../../src/client/events.js";
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
	/** Delay in ms before content() resolves, simulated via setTimeout. */
	contentDelayMs?: number;
	/**
	 * Optional DOM data queried via page.$$eval (used by adapters).
	 * Keyed by selector; value is whatever the evaluator returns.
	 */
	evalResults?: Record<string, unknown>;
	/** Selector → outerHTML string (match) or null (no match). */
	selectorMatchHtml?: Record<string, string | null>;
	/** Wait-for-selector behavior. "resolve" → visible immediately; "never" → times out; Error → thrown. */
	waitForSelectorBehavior?: "resolve" | "never" | Error;
	/** Optional delay before waitForSelector resolves. */
	waitForSelectorDelayMs?: number;
	/** Bytes returned by page.screenshot(); pass an Error to throw. */
	screenshotBytes?: Buffer | Error;
}

export interface FakeControls {
	pagesOpened: number;
	pagesClosed: number;
	launchCount: number;
	contextsOpened: number;
	contextsClosed: number;
	connected: boolean;
	lastGotoWaitUntil?: string;
	setConnected(value: boolean): void;
}

export interface FakeLauncherOptions {
	pageBehavior?: (url: string) => FakePageResponse;
	launchDelayMs?: number;
	launchFails?: Error;
	progressEvents?: BinaryDownloadProgressEvent[];
}

export function makeFakeLauncher(
	opts: FakeLauncherOptions = {},
): Launcher & { readonly fake: FakeControls } {
	const controls: FakeControls = {
		pagesOpened: 0,
		pagesClosed: 0,
		launchCount: 0,
		contextsOpened: 0,
		contextsClosed: 0,
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
				options?: { timeout?: number; waitUntil?: string },
			): Promise<Response | null> {
				if (options?.waitUntil) controls.lastGotoWaitUntil = options.waitUntil;
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
				if (behavior.contentDelayMs && behavior.contentDelayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, behavior.contentDelayMs));
				}
				if (closed) {
					throw new Error("Target page, context or browser has been closed");
				}
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
						// Honor maxResults (first evaluator arg) so smart-passthrough tests
						// exercise the cap the same way the real adapter evaluator would.
						const max = typeof args[0] === "number" ? args[0] : value.length;
						return value.slice(0, max) as unknown as T;
					}
					return evaluator(value as unknown[], ...args);
				}
				return [] as unknown as T;
			},
			async waitForSelector(
				selector: string,
				opts?: { state?: string; timeout?: number },
			): Promise<void> {
				const behavior = pageBehavior(currentUrl);
				const b = behavior.waitForSelectorBehavior ?? "resolve";
				if (b instanceof Error) throw b;
				if (behavior.waitForSelectorDelayMs && behavior.waitForSelectorDelayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, behavior.waitForSelectorDelayMs));
				}
				if (b === "never") {
					const timeout = opts?.timeout ?? 30_000;
					await new Promise((resolve) => setTimeout(resolve, timeout));
					const err = new Error(`Timeout ${timeout}ms exceeded waiting for ${selector}`);
					err.name = "TimeoutError";
					throw err;
				}
				// b === "resolve" — no-op.
				void selector;
			},
			locator(selector: string) {
				const behavior = pageBehavior(currentUrl);
				const match = behavior.selectorMatchHtml?.[selector];
				const hasMatch = match !== undefined && match !== null;
				const result = {
					first() {
						return {
							async count(): Promise<number> {
								return hasMatch ? 1 : 0;
							},
							async evaluate<T>(fn: (el: { outerHTML: string }) => T): Promise<T> {
								if (!hasMatch) throw new Error("no element");
								return fn({ outerHTML: match as string });
							},
							async waitFor(opts?: { state?: string; timeout?: number }): Promise<void> {
								const b = behavior.waitForSelectorBehavior ?? "resolve";
								if (b instanceof Error) throw b;
								if (behavior.waitForSelectorDelayMs && behavior.waitForSelectorDelayMs > 0) {
									await new Promise((r) => setTimeout(r, behavior.waitForSelectorDelayMs));
								}
								if (b === "never") {
									const timeout = opts?.timeout ?? 30_000;
									await new Promise((r) => setTimeout(r, timeout));
									const err = new Error(`Timeout ${timeout}ms exceeded`);
									err.name = "TimeoutError";
									throw err;
								}
							},
						};
					},
				};
				return result;
			},
			async screenshot(opts?: {
				fullPage?: boolean;
				type?: "png" | "jpeg";
				quality?: number;
			}): Promise<Buffer> {
				void opts;
				const behavior = pageBehavior(currentUrl);
				if (behavior.screenshotBytes instanceof Error) throw behavior.screenshotBytes;
				return behavior.screenshotBytes ?? Buffer.from("fake-png");
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

	const makeContext = (): BrowserContext => {
		controls.contextsOpened += 1;
		let ctxClosed = false;
		return {
			async newPage(): Promise<Page> {
				return makePage();
			},
			async close(): Promise<void> {
				if (!ctxClosed) {
					ctxClosed = true;
					controls.contextsClosed += 1;
				}
			},
		} as unknown as BrowserContext;
	};

	const defaultContext = makeContext();

	const browser = {
		isConnected(): boolean {
			return controls.connected;
		},
		async newContext(): Promise<BrowserContext> {
			return makeContext();
		},
		async close(): Promise<void> {
			controls.connected = false;
		},
	} as unknown as Browser;

	return {
		fake: controls,
		async launch(
			launchOpts: { onProgress?: (e: BinaryDownloadProgressEvent) => void } = {},
		): Promise<LaunchedBrowser> {
			controls.launchCount += 1;
			if (opts.progressEvents && launchOpts.onProgress) {
				for (const ev of opts.progressEvents) launchOpts.onProgress(ev);
			}
			if (opts.launchDelayMs && opts.launchDelayMs > 0) {
				await new Promise((resolve) => setTimeout(resolve, opts.launchDelayMs));
			}
			if (opts.launchFails) throw opts.launchFails;
			return { browser, context: defaultContext, version: "fake-0.0.0" };
		},
	};
}
