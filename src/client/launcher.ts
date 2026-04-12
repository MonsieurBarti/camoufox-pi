// Launcher interface. The ONE place that may import camoufox-js.
// RealLauncher lands in a later task; tests use a fake via tests/helpers/fake-launcher.
// Spec: §2, §4.3, §8.

import type { Browser, BrowserContext } from "playwright-core";

export interface LaunchedBrowser {
	readonly browser: Browser;
	readonly context: BrowserContext;
	readonly version: string;
}

export interface Launcher {
	launch(signal?: AbortSignal): Promise<LaunchedBrowser>;
}
