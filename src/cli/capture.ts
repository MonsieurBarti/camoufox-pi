import type { Launcher } from "../client/launcher.js";

export interface CaptureOptions {
	readonly source: string;
	readonly loginUrl: string;
	readonly loggedInUrlPattern?: RegExp;
	readonly launcher: Launcher;
	readonly log: (line: string) => void;
	readonly promptLine: (msg: string) => Promise<string>;
	readonly signal?: AbortSignal;
}

export interface CaptureResult {
	readonly storageStateJson: string;
}

export async function captureCookieJar(opts: CaptureOptions): Promise<CaptureResult> {
	const launched = await opts.launcher.launch();
	try {
		const page = await launched.context.newPage();
		await page.goto(opts.loginUrl, { waitUntil: "domcontentloaded" });
		const urlHint = opts.loggedInUrlPattern ? " — or navigate to your home page" : "";
		opts.log(
			`A browser window opened at ${opts.loginUrl}. Log in, then press Enter here${urlHint} — to save the session.`,
		);

		const enterPromise = opts.promptLine("press Enter when logged in: ");
		const urlPromise: Promise<unknown> = opts.loggedInUrlPattern
			? page.waitForURL(opts.loggedInUrlPattern, { timeout: 0 })
			: new Promise(() => {});
		const closePromise = new Promise<never>((_, reject) => {
			launched.context.once("close", () => {
				reject(new Error("browser closed before capture completed"));
			});
		});
		const abortPromise = opts.signal
			? new Promise<never>((_, reject) => {
					const sig = opts.signal as AbortSignal;
					if (sig.aborted) reject(new Error("aborted"));
					sig.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				})
			: new Promise<never>(() => {});

		await Promise.race([enterPromise, urlPromise, closePromise, abortPromise]);
		const state = await launched.context.storageState();
		return { storageStateJson: JSON.stringify(state) };
	} finally {
		try {
			await launched.context.close();
		} catch {
			// ignore
		}
		try {
			await launched.browser.close();
		} catch {
			// ignore
		}
	}
}
