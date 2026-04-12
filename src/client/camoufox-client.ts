import type { Browser, BrowserContext } from "playwright-core";

import { CamoufoxErrorBox } from "../errors.js";
import type { CamoufoxConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";
import type { Launcher } from "./launcher.js";

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
			this.state = { status: "ready", browser, context, version };
		} catch (err) {
			const stderr = err instanceof Error ? err.message : String(err);
			const boxed = new CamoufoxErrorBox({ type: "browser_launch_failed", stderr });
			this.state = { status: "failed", error: boxed };
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
