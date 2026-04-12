// Single seam for turning Playwright / camoufox-js exceptions into typed
// CamoufoxError values. Spec: §4.2, §5.1.

export type CamoufoxError =
	| {
			type: "timeout";
			phase: "nav" | "wait_ready" | "wait_for_selector" | "screenshot";
			elapsedMs: number;
	  }
	| { type: "network"; cause: string; url: string }
	| { type: "http"; status: number; url: string }
	| { type: "browser_launch_failed"; stderr: string }
	| { type: "playwright_disconnected" }
	| { type: "aborted" }
	| { type: "config_invalid"; field: string; reason: string };

function sanitizeForMessage(err: CamoufoxError): string {
	// Cap stderr and redact URL query strings from error payloads before
	// serializing into .message (which can surface in logs / stack traces).
	const redacted: Record<string, unknown> = { ...err };
	if (typeof redacted.stderr === "string" && redacted.stderr.length > 500) {
		redacted.stderr = `${redacted.stderr.slice(0, 500)}…[${redacted.stderr.length} bytes]`;
	}
	if (typeof redacted.url === "string") {
		try {
			const u = new URL(redacted.url);
			redacted.url = `${u.origin}${u.pathname}`;
		} catch {
			// leave as-is if unparseable
		}
	}
	try {
		return JSON.stringify(redacted);
	} catch {
		return "[unserializable error payload]";
	}
}

export class CamoufoxErrorBox extends Error {
	public readonly err: CamoufoxError;

	constructor(err: CamoufoxError) {
		super(`${err.type}: ${sanitizeForMessage(err)}`);
		this.name = "CamoufoxError";
		this.err = err;
	}
}

export interface MapContext {
	readonly url?: string;
	readonly phase?: "nav" | "wait_ready" | "wait_for_selector" | "screenshot";
	readonly elapsedMs?: number;
	readonly signal?: AbortSignal;
}

const NETWORK_PATTERN = /net::ERR_|NS_ERROR_NET_|getaddrinfo/;

export function mapPlaywrightError(err: unknown, ctx: MapContext): CamoufoxError {
	if (!(err instanceof Error)) {
		// Unknown non-Error throwable — can't safely classify. Wrap as unknown.
		return { type: "browser_launch_failed", stderr: String(err) };
	}
	// TimeoutError is a distinct signal even when abort also fired — classify
	// it first so internal-timeout-via-combined-signal doesn't swallow a
	// genuine page timeout.
	if (err.name === "TimeoutError") {
		return { type: "timeout", phase: ctx.phase ?? "nav", elapsedMs: ctx.elapsedMs ?? 0 };
	}
	if (err.name === "AbortError" || ctx.signal?.aborted) {
		return { type: "aborted" };
	}
	if (NETWORK_PATTERN.test(err.message)) {
		return { type: "network", cause: err.message, url: ctx.url ?? "" };
	}
	// Unknown Error — classify as launch-failed with stderr for
	// observability. Tool callers see CamoufoxErrorBox uniformly.
	return { type: "browser_launch_failed", stderr: err.message };
}
