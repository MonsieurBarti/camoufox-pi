import type { Browser, BrowserContext, Page } from "playwright-core";

import { CamoufoxErrorBox, mapPlaywrightError } from "../errors.js";
import { duckduckgoAdapter } from "../search/adapters/duckduckgo.js";
import type { RawResult } from "../search/types.js";
import type { CamoufoxConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";
import type { Launcher } from "./launcher.js";
import { combineSignals } from "./signal.js";

interface ReadyState {
	status: "idle" | "launching" | "ready" | "failed" | "closed";
	browser?: Browser;
	context?: BrowserContext;
	version?: string;
	error?: CamoufoxErrorBox;
	launchPromise?: Promise<void>;
}

export interface CamoufoxClientOptions {
	readonly launcher: Launcher;
	readonly config?: CamoufoxConfig;
}

export class CamoufoxClient {
	private readonly launcher: Launcher;
	private readonly config: CamoufoxConfig;
	private state: ReadyState = { status: "idle" };

	constructor(opts: CamoufoxClientOptions) {
		this.launcher = opts.launcher;
		this.config = opts.config ?? DEFAULT_CONFIG;
	}

	isAlive(): boolean {
		return this.state.status === "ready" && this.state.browser?.isConnected() === true;
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
		const launchPromise = this.doLaunch();
		this.state = { status: "launching", launchPromise };
		await this.awaitWithSignal(launchPromise, signal);
	}

	async fetchUrl(
		url: string,
		opts: { signal: AbortSignal; timeoutMs?: number },
	): Promise<{ html: string; status: number; finalUrl: string }> {
		await this.ensureReady(opts.signal);
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
		const { page, response, cleanup } = await this.navigate(url, {
			signal: opts.signal,
			timeoutMs: opts.timeoutMs ?? this.config.timeoutMs,
			waitUntil: "load",
		});
		try {
			const html = await page.content();
			return { html, status: response.status(), finalUrl: response.url() };
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
	}

	async search(
		query: string,
		opts: { signal: AbortSignal; maxResults?: number; timeoutMs?: number },
	): Promise<{ results: RawResult[]; engine: "duckduckgo"; query: string }> {
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
		const { page, cleanup } = await this.navigate(url, {
			signal: opts.signal,
			timeoutMs: opts.timeoutMs ?? this.config.timeoutMs,
			waitUntil: adapter.waitStrategy.readyState,
		});
		try {
			const results = await adapter.parseResults(page, maxResults);
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
	}

	protected async navigate(
		url: string,
		opts: {
			signal: AbortSignal;
			timeoutMs: number;
			waitUntil: "load" | "domcontentloaded" | "networkidle";
		},
	): Promise<{
		page: Page;
		response: { status(): number; url(): string };
		cleanup: () => void;
	}> {
		const context = this.getContext();
		const combined = combineSignals(opts.signal, opts.timeoutMs);
		const page = await context.newPage();
		const abortHandler = () => {
			page.close().catch(() => undefined);
		};
		combined.signal.addEventListener("abort", abortHandler, { once: true });
		const cleanup = () => {
			combined.signal.removeEventListener("abort", abortHandler);
			combined.cleanup();
		};
		const started = Date.now();
		try {
			const response = await page.goto(url, {
				timeout: opts.timeoutMs,
				waitUntil: opts.waitUntil,
			});
			if (!response) {
				throw new CamoufoxErrorBox({
					type: "network",
					cause: "goto returned null",
					url,
				});
			}
			const status = response.status();
			if (status >= 400) {
				throw new CamoufoxErrorBox({ type: "http", status, url: response.url() });
			}
			return { page, response, cleanup };
		} catch (err) {
			cleanup();
			await page.close().catch(() => undefined);
			if (err instanceof CamoufoxErrorBox) throw err;
			const mapped = mapPlaywrightError(err, {
				url,
				phase: "nav",
				elapsedMs: Date.now() - started,
				signal: combined.signal,
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

	private async doLaunch(): Promise<void> {
		try {
			const { browser, context, version } = await this.launcher.launch();
			// If close() was called while we were launching, tear down the fresh
			// browser instead of resurrecting into ready. Leaves state as "closed".
			if (this.state.status !== "launching") {
				await browser.close().catch(() => undefined);
				return;
			}
			this.state = { status: "ready", browser, context, version };
		} catch (err) {
			const stderr = err instanceof Error ? err.message : String(err);
			const boxed = new CamoufoxErrorBox({ type: "browser_launch_failed", stderr });
			// If close() was called during the failed launch, keep the closed state
			// (don't overwrite it with failed — closed is terminal).
			if (this.state.status === "launching") {
				this.state = { status: "failed", error: boxed };
			}
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
