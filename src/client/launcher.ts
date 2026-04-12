// Launcher interface. The ONE place that may import camoufox-js.
// RealLauncher lands in a later task; tests use a fake via tests/helpers/fake-launcher.
// Spec: §2, §4.3, §8.

import { launchOptions as camoufoxLaunchOptions } from "camoufox-js";
import { type Browser, type BrowserContext, firefox } from "playwright-core";

export interface LaunchedBrowser {
	readonly browser: Browser;
	readonly context: BrowserContext;
	readonly version: string;
}

export interface Launcher {
	launch(signal?: AbortSignal): Promise<LaunchedBrowser>;
}

export interface RealLauncherOptions {
	/** Headless? Default: true. Override for local debugging. */
	readonly headless?: boolean;
	/** Override the Camoufox binary path. */
	readonly binaryPath?: string;
}

/**
 * Real launcher: calls camoufox-js for fingerprint + binary-aware
 * launch options, then drives playwright-core's firefox.launch.
 * This is the ONLY file in the codebase that may import camoufox-js.
 * Spec: §2, §8.
 */
export class RealLauncher implements Launcher {
	private readonly headless: boolean;
	private readonly binaryPath: string | undefined;

	constructor(opts: RealLauncherOptions = {}) {
		this.headless = opts.headless ?? true;
		this.binaryPath = opts.binaryPath;
	}

	async launch(_signal?: AbortSignal): Promise<LaunchedBrowser> {
		const launchOpts = (await camoufoxLaunchOptions({
			headless: this.headless,
			...(this.binaryPath !== undefined ? { executablePath: this.binaryPath } : {}),
		})) as Parameters<typeof firefox.launch>[0];
		const browser = await firefox.launch(launchOpts);
		const context = await browser.newContext();
		const version = browser.version();
		return { browser, context, version };
	}
}
