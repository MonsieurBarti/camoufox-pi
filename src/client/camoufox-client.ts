import type { Browser, BrowserContext, Page } from "playwright-core";

import { CamoufoxErrorBox, mapPlaywrightError, sanitizeReason } from "../errors.js";
import { duckduckgoAdapter } from "../search/adapters/duckduckgo.js";
import type { RawResult } from "../search/types.js";
import { type SsrfGuard, attachSsrfGuard } from "../security/redirect-guard.js";
import { type LookupFn, assertSafeTarget } from "../security/ssrf.js";
import type { CamoufoxConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";
import {
	type BinaryDownloadProgressEvent,
	type BrowserLaunchEvent,
	type CamoufoxEventEmitter,
	type ErrorEvent,
	createEventEmitter,
	newSpanId,
} from "./events.js";
import {
	type Format,
	type RenderMode,
	SCREENSHOT_MAX_BYTES,
	type ScreenshotOpts,
	type ScreenshotResult,
	capturePageScreenshot,
	extractSlice,
	htmlToMarkdown,
	resolveWaitUntil,
	validateFetchUrlOpts,
	waitForSelectorOrThrow,
} from "./fetch-pipeline.js";
import type { Launcher } from "./launcher.js";
import { combineSignals } from "./signal.js";

export interface HealthStatus {
	status: "launching" | "ready" | "failed" | "closed";
	browserConnected: boolean;
	browserVersion: string | null;
	launchedAt: number | null;
	uptimeMs: number | null;
	lastError: import("../errors.js").CamoufoxError | null;
	probe?: {
		ok: boolean;
		roundTripMs: number;
		error: import("../errors.js").CamoufoxError | null;
	};
}

interface ReadyState {
	status: "idle" | "launching" | "ready" | "failed" | "closed";
	browser?: Browser;
	context?: BrowserContext;
	version?: string;
	error?: CamoufoxErrorBox;
	launchPromise?: Promise<void>;
	launchedAt?: number;
}

export interface CamoufoxClientOptions {
	readonly launcher: Launcher;
	readonly config?: CamoufoxConfig;
	/** Optional DNS lookup override; used to inject stubs in tests. */
	readonly ssrfLookup?: LookupFn;
}

export class CamoufoxClient {
	readonly events: CamoufoxEventEmitter = createEventEmitter();
	private readonly launcher: Launcher;
	readonly config: CamoufoxConfig;
	private readonly ssrfLookup: LookupFn | undefined;
	private state: ReadyState = { status: "idle" };

	constructor(opts: CamoufoxClientOptions) {
		this.launcher = opts.launcher;
		this.config = opts.config ?? DEFAULT_CONFIG;
		this.ssrfLookup = opts.ssrfLookup;
	}

	isAlive(): boolean {
		return this.state.status === "ready" && this.state.browser?.isConnected() === true;
	}

	async checkHealth(opts: { probe?: boolean; signal?: AbortSignal } = {}): Promise<HealthStatus> {
		const status: HealthStatus["status"] =
			this.state.status === "idle" ? "launching" : this.state.status;
		const snapshot: HealthStatus = {
			status,
			browserConnected:
				this.state.status === "ready" ? this.state.browser?.isConnected() === true : false,
			browserVersion: this.state.version ?? null,
			launchedAt: this.state.launchedAt ?? null,
			uptimeMs:
				this.state.status === "ready" && this.state.launchedAt
					? Date.now() - this.state.launchedAt
					: null,
			lastError: this.state.status === "failed" && this.state.error ? this.state.error.err : null,
		};
		if (opts.probe) {
			if (this.state.status !== "ready" || !this.state.context || !this.state.browser) {
				snapshot.probe = {
					ok: false,
					roundTripMs: 0,
					error: { type: "playwright_disconnected" },
				};
				return snapshot;
			}
			const probeStarted = Date.now();
			try {
				const page = await this.state.context.newPage();
				try {
					await page.goto("about:blank", { timeout: 2_000, waitUntil: "load" });
					snapshot.probe = {
						ok: true,
						roundTripMs: Date.now() - probeStarted,
						error: null,
					};
				} finally {
					await page.close().catch(() => undefined);
				}
			} catch (err) {
				const mapped = mapPlaywrightError(err, {
					url: "about:blank",
					phase: "nav",
					elapsedMs: Date.now() - probeStarted,
					...(opts.signal !== undefined ? { signal: opts.signal } : {}),
				});
				snapshot.probe = {
					ok: false,
					roundTripMs: Date.now() - probeStarted,
					error: mapped,
				};
			}
		}
		return snapshot;
	}

	private emitError(spanId: string, op: ErrorEvent["op"], err: unknown): void {
		if (err instanceof CamoufoxErrorBox) {
			this.events.emit("error", { spanId, op, error: err.err });
		}
	}

	async ensureReady(signal?: AbortSignal): Promise<void> {
		if (this.state.status === "ready") return;
		if (this.state.status === "failed" && this.state.error) throw this.state.error;
		if (this.state.status === "closed") {
			throw new CamoufoxErrorBox({ type: "playwright_disconnected" });
		}
		if (this.state.status === "launching" && this.state.launchPromise) {
			await this.awaitWithSignal(this.state.launchPromise, signal);
			return;
		}
		const spanId = newSpanId();
		const launchPromise = this.doLaunch(spanId);
		this.state = { status: "launching", launchPromise };
		await this.awaitWithSignal(launchPromise, signal);
	}

	async fetchUrl(
		url: string,
		opts: {
			signal: AbortSignal;
			timeoutMs?: number;
			maxBytes?: number;
			isolate?: boolean;
			renderMode?: RenderMode;
			waitForSelector?: string;
			selector?: string;
			format?: Format;
			screenshot?: ScreenshotOpts;
		},
	): Promise<{
		html: string;
		markdown?: string;
		screenshot?: ScreenshotResult;
		status: number;
		finalUrl: string;
		bytes: number;
		truncated: boolean;
	}> {
		const spanId = newSpanId();
		const started = Date.now();
		try {
			await this.ensureReady(opts.signal);
			const { renderMode, format } = validateFetchUrlOpts(opts);
			try {
				await assertSafeTarget(url, this.ssrfLookup ? { lookup: this.ssrfLookup } : {});
			} catch (err) {
				throw new CamoufoxErrorBox({
					type: "ssrf_blocked",
					hop: "initial",
					url,
					reason: sanitizeReason(err instanceof Error ? err.message : String(err)),
				});
			}
			const navOpts: {
				signal: AbortSignal;
				timeoutMs: number;
				waitUntil: "load" | "domcontentloaded" | "networkidle";
				isolate?: boolean;
			} = {
				signal: opts.signal,
				timeoutMs: opts.timeoutMs ?? this.config.timeoutMs,
				waitUntil: resolveWaitUntil(renderMode),
			};
			if (opts.isolate !== undefined) navOpts.isolate = opts.isolate;
			const { page, response, cleanup } = await this.navigate(url, navOpts);
			let currentPhase: "nav" | "wait_for_selector" | "screenshot" | "extract" = "nav";
			try {
				if (opts.waitForSelector !== undefined) {
					currentPhase = "wait_for_selector";
					const remaining = Math.max(
						0,
						(opts.timeoutMs ?? this.config.timeoutMs) - (Date.now() - started),
					);
					await waitForSelectorOrThrow(page, opts.waitForSelector, remaining);
				}
				let screenshotResult: ScreenshotResult | undefined;
				if (opts.screenshot !== undefined) {
					currentPhase = "screenshot";
					screenshotResult = await capturePageScreenshot(page, opts.screenshot);
					if (screenshotResult.bytes > SCREENSHOT_MAX_BYTES) {
						throw new CamoufoxErrorBox({
							type: "config_invalid",
							field: "screenshot",
							reason: `exceeds 10 MiB cap (got ${screenshotResult.bytes} bytes)`,
						});
					}
				}
				currentPhase = "extract";
				const { html: rawHtml } = await extractSlice(page, opts.selector);
				const finalUrl = response.url();
				let body: string;
				if (format === "markdown") {
					try {
						body = htmlToMarkdown(rawHtml, finalUrl);
					} catch (err) {
						throw new CamoufoxErrorBox({
							type: "config_invalid",
							field: "markdown",
							reason: sanitizeReason(
								`markdown conversion failed: ${err instanceof Error ? err.message : String(err)}`,
							),
						});
					}
				} else {
					body = rawHtml;
				}

				const maxBytes = opts.maxBytes ?? this.config.maxBytes;
				const rawBytes = Buffer.byteLength(body, "utf8");
				let cappedBody = body;
				let bytes = rawBytes;
				let truncated = false;
				if (rawBytes > maxBytes) {
					const buf = Buffer.from(body, "utf8");
					cappedBody = buf.subarray(0, maxBytes).toString("utf8");
					bytes = Buffer.byteLength(cappedBody, "utf8");
					truncated = true;
				}

				const result: {
					html: string;
					markdown?: string;
					screenshot?: ScreenshotResult;
					status: number;
					finalUrl: string;
					bytes: number;
					truncated: boolean;
				} = {
					html: format === "html" ? cappedBody : rawHtml,
					status: response.status(),
					finalUrl,
					bytes,
					truncated,
				};
				if (format === "markdown") result.markdown = cappedBody;
				if (screenshotResult) result.screenshot = screenshotResult;
				this.events.emit("fetch_url", {
					spanId,
					url,
					finalUrl: result.finalUrl,
					status: result.status,
					bytes: result.bytes,
					truncated: result.truncated,
					isolate: opts.isolate ?? false,
					durationMs: Date.now() - started,
					renderMode,
					usedWaitForSelector: opts.waitForSelector !== undefined,
					usedSelector: opts.selector !== undefined,
					format,
					screenshotBytes: screenshotResult?.bytes ?? null,
				});
				return result;
			} catch (err) {
				if (opts.signal.aborted) {
					throw new CamoufoxErrorBox({ type: "aborted" });
				}
				if (err instanceof CamoufoxErrorBox) throw err;
				const mapped = mapPlaywrightError(err, {
					url: response.url(),
					phase: currentPhase,
					elapsedMs: Date.now() - started,
					signal: opts.signal,
				});
				throw new CamoufoxErrorBox(mapped);
			} finally {
				cleanup();
				await page.close().catch(() => undefined);
			}
		} catch (err) {
			this.emitError(spanId, "fetchUrl", err);
			throw err;
		}
	}

	async search(
		query: string,
		opts: {
			signal: AbortSignal;
			maxResults?: number;
			timeoutMs?: number;
			isolate?: boolean;
		},
	): Promise<{ results: RawResult[]; engine: "duckduckgo"; query: string }> {
		const spanId = newSpanId();
		const started = Date.now();
		try {
			await this.ensureReady(opts.signal);
			const maxResults = opts.maxResults ?? 10;
			if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) {
				throw new CamoufoxErrorBox({
					type: "config_invalid",
					field: "maxResults",
					reason: `must be integer in [1, 50], got ${maxResults}`,
				});
			}
			if (
				opts.timeoutMs !== undefined &&
				(!Number.isInteger(opts.timeoutMs) || opts.timeoutMs < 1_000 || opts.timeoutMs > 120_000)
			) {
				throw new CamoufoxErrorBox({
					type: "config_invalid",
					field: "timeoutMs",
					reason: `must be integer in [1000, 120000], got ${opts.timeoutMs}`,
				});
			}
			const adapter = duckduckgoAdapter;
			const url = adapter.buildUrl(query);
			try {
				await assertSafeTarget(url, this.ssrfLookup ? { lookup: this.ssrfLookup } : {});
			} catch (err) {
				throw new CamoufoxErrorBox({
					type: "ssrf_blocked",
					hop: "initial",
					url,
					reason: sanitizeReason(err instanceof Error ? err.message : String(err)),
				});
			}
			const navOpts: {
				signal: AbortSignal;
				timeoutMs: number;
				waitUntil: "load" | "domcontentloaded" | "networkidle";
				isolate?: boolean;
			} = {
				signal: opts.signal,
				timeoutMs: opts.timeoutMs ?? this.config.timeoutMs,
				waitUntil: adapter.waitStrategy.readyState,
			};
			if (opts.isolate !== undefined) navOpts.isolate = opts.isolate;
			const { page, cleanup } = await this.navigate(url, navOpts);
			try {
				const results = await adapter.parseResults(page, maxResults);
				this.events.emit("search", {
					spanId,
					engine: "duckduckgo",
					query,
					maxResults,
					durationMs: Date.now() - started,
					resultCount: results.length,
					atLimit: results.length === maxResults,
				});
				return { results, engine: "duckduckgo", query };
			} catch (err) {
				if (opts.signal.aborted) {
					throw new CamoufoxErrorBox({ type: "aborted" });
				}
				if (err instanceof CamoufoxErrorBox) throw err;
				throw err;
			} finally {
				cleanup();
				await page.close().catch(() => undefined);
			}
		} catch (err) {
			this.emitError(spanId, "search", err);
			throw err;
		}
	}

	protected async navigate(
		url: string,
		opts: {
			signal: AbortSignal;
			timeoutMs: number;
			waitUntil: "load" | "domcontentloaded" | "networkidle";
			isolate?: boolean;
		},
	): Promise<{
		page: Page;
		response: { status(): number; url(): string };
		cleanup: () => void;
		guard: SsrfGuard;
	}> {
		let context: BrowserContext;
		let ownContext = false;
		if (opts.isolate) {
			const browser = this.getBrowser();
			context = await browser.newContext();
			ownContext = true;
		} else {
			context = this.getContext();
		}
		const combined = combineSignals(opts.signal, opts.timeoutMs);
		const page = await context.newPage();
		const guard = await attachSsrfGuard(page, this.ssrfLookup ? { lookup: this.ssrfLookup } : {});
		const abortHandler = () => {
			page.close().catch(() => undefined);
		};
		combined.signal.addEventListener("abort", abortHandler, { once: true });
		const cleanup = () => {
			combined.signal.removeEventListener("abort", abortHandler);
			combined.cleanup();
			guard.detach().catch(() => undefined);
			if (ownContext) {
				context.close().catch(() => undefined);
			}
		};
		const started = Date.now();
		try {
			let response: Awaited<ReturnType<Page["goto"]>>;
			try {
				response = await page.goto(url, {
					timeout: opts.timeoutMs,
					waitUntil: opts.waitUntil,
				});
			} catch (err) {
				const blocked = guard.getBlockedHop();
				if (blocked) {
					throw new CamoufoxErrorBox({
						type: "ssrf_blocked",
						hop: blocked.hop,
						url: blocked.url,
						reason: sanitizeReason(blocked.reason),
					});
				}
				throw err;
			}
			if (!response) {
				throw new CamoufoxErrorBox({
					type: "network",
					cause: "goto returned null",
					url,
				});
			}
			const blockedAfterGoto = guard.getBlockedHop();
			if (blockedAfterGoto) {
				throw new CamoufoxErrorBox({
					type: "ssrf_blocked",
					hop: blockedAfterGoto.hop,
					url: blockedAfterGoto.url,
					reason: sanitizeReason(blockedAfterGoto.reason),
				});
			}
			const status = response.status();
			if (status >= 400) {
				throw new CamoufoxErrorBox({ type: "http", status, url: response.url() });
			}
			return { page, response, cleanup, guard };
		} catch (err) {
			cleanup();
			await page.close().catch(() => undefined);
			if (err instanceof CamoufoxErrorBox) throw err;
			const mapped = mapPlaywrightError(err, {
				url,
				phase: "nav",
				elapsedMs: Date.now() - started,
				signal: opts.signal,
			});
			throw new CamoufoxErrorBox(mapped);
		}
	}

	async close(): Promise<void> {
		const browser = this.state.browser;
		this.state = { status: "closed" };
		if (browser) {
			try {
				await browser.close();
			} catch {
				// browser already dead — ignore
			}
		}
	}

	protected getConfig(): CamoufoxConfig {
		return this.config;
	}

	protected getContext(): BrowserContext {
		if (this.state.status !== "ready" || !this.state.context) {
			throw new CamoufoxErrorBox({ type: "playwright_disconnected" });
		}
		if (this.state.browser?.isConnected() !== true) {
			throw new CamoufoxErrorBox({ type: "playwright_disconnected" });
		}
		return this.state.context;
	}

	protected getBrowser(): Browser {
		if (this.state.status !== "ready" || !this.state.browser) {
			throw new CamoufoxErrorBox({ type: "playwright_disconnected" });
		}
		if (!this.state.browser.isConnected()) {
			throw new CamoufoxErrorBox({ type: "playwright_disconnected" });
		}
		return this.state.browser;
	}

	private async doLaunch(spanId: string): Promise<void> {
		const started = Date.now();
		try {
			const { browser, context, version } = await this.launcher.launch({
				onProgress: (e: BinaryDownloadProgressEvent) =>
					this.events.emit("binary_download_progress", e),
			});
			// If close() was called while we were launching, tear down the fresh
			// browser instead of resurrecting into ready. Leaves state as "closed".
			if (this.state.status !== "launching") {
				await browser.close().catch(() => undefined);
				return;
			}
			this.state = {
				status: "ready",
				browser,
				context,
				version,
				launchedAt: Date.now(),
			};
			const payload: BrowserLaunchEvent = {
				spanId,
				browserVersion: version,
				durationMs: Date.now() - started,
			};
			this.events.emit("browser_launch", payload);
		} catch (err) {
			const stderr = err instanceof Error ? err.message : String(err);
			const camErr = { type: "browser_launch_failed" as const, stderr };
			const boxed = new CamoufoxErrorBox(camErr);
			// If close() was called during the failed launch, keep the closed
			// state (don't overwrite it with failed — closed is terminal).
			if (this.state.status === "launching") {
				this.state = { status: "failed", error: boxed };
			}
			const errPayload: ErrorEvent = { spanId, op: "ensureReady", error: camErr };
			this.events.emit("error", errPayload);
			throw boxed;
		}
	}

	private async awaitWithSignal<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
		if (!signal) return p;
		if (signal.aborted) throw new CamoufoxErrorBox({ type: "aborted" });
		return new Promise<T>((resolve, reject) => {
			const onAbort = () => {
				signal.removeEventListener("abort", onAbort);
				reject(new CamoufoxErrorBox({ type: "aborted" }));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			p.then(
				(v) => {
					signal.removeEventListener("abort", onAbort);
					resolve(v);
				},
				(e) => {
					signal.removeEventListener("abort", onAbort);
					reject(e);
				},
			);
		});
	}
}
