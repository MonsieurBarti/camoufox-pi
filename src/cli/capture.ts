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
	let done = false;
	try {
		const page = await launched.context.newPage();
		await page.goto(opts.loginUrl, { waitUntil: "domcontentloaded" });
		opts.log(buildCaptureHint(opts));

		const enterPromise = opts
			.promptLine("press Enter when logged in: ")
			.then(() => "enter" as const);

		const urlPromise: Promise<"url"> = opts.loggedInUrlPattern
			? page.waitForURL(opts.loggedInUrlPattern, { timeout: 0 }).then(() => "url" as const)
			: new Promise<"url">(() => {});
		// Suppress late rejections after Promise.race has already settled via another
		// promise. This is a cleanup handler, not an error swallow — we already have
		// the outcome we need by the time this fires.
		urlPromise.catch(() => {});

		const closePromise = new Promise<never>((_resolve, reject) => {
			launched.context.once("close", () => {
				if (!done) reject(new Error("browser closed before capture completed"));
			});
		});
		// Suppress late rejections from the close listener once we've already settled.
		closePromise.catch(() => {});

		const abortPromise: Promise<never> = opts.signal
			? new Promise<never>((_resolve, reject) => {
					const sig = opts.signal as AbortSignal;
					const abortWith = (): void => {
						const reason: unknown = (sig as AbortSignal & { reason?: unknown }).reason;
						if (reason instanceof Error) reject(reason);
						else
							reject(
								new DOMException(typeof reason === "string" ? reason : "aborted", "AbortError"),
							);
					};
					if (sig.aborted) abortWith();
					else sig.addEventListener("abort", abortWith, { once: true });
				})
			: new Promise<never>(() => {});
		abortPromise.catch(() => {});

		const winner = await Promise.race([enterPromise, urlPromise, closePromise, abortPromise]);

		// Guard: if the URL watcher fired, confirm the page actually left the login URL.
		// A page bounce-back (JS redirect back to /login after a failed auth) can
		// trigger waitForURL on an intermediate URL and then settle on the wrong page.
		// We do NOT apply this invariant to the "enter" winner — when a user presses
		// Enter manually on single-page apps, trust their judgment.
		if (winner === "url" && page.url() === opts.loginUrl) {
			throw new Error("URL watcher matched but page returned to login");
		}

		const state = await launched.context.storageState();
		done = true;
		return { storageStateJson: JSON.stringify(state) };
	} finally {
		await closeWithTimeout(() => launched.context.close(), 5_000);
		await closeWithTimeout(() => launched.browser.close(), 5_000);
	}
}

async function closeWithTimeout(fn: () => Promise<void>, ms: number): Promise<void> {
	try {
		await Promise.race([
			fn(),
			new Promise<void>((resolve) => {
				const t = setTimeout(resolve, ms);
				// Don't hold the event loop open just for the timeout.
				if (typeof t === "object" && t !== null && "unref" in t) (t as NodeJS.Timeout).unref();
			}),
		]);
	} catch {
		// Close errors during teardown are non-recoverable; ignore them.
	}
}

function buildCaptureHint(opts: CaptureOptions): string {
	const base = `A browser window opened at ${opts.loginUrl}. Log in, then press Enter here`;
	return opts.loggedInUrlPattern
		? `${base} — or navigate to a logged-in page — to save the session.`
		: `${base} to save the session.`;
}
