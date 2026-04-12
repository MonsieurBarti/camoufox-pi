// Single seam for turning Playwright / camoufox-js exceptions into typed
// CamoufoxError values. Spec: §4.2, §5.1.

export type CamoufoxError =
	| { type: "timeout"; phase: "nav" | "wait_ready"; elapsedMs: number }
	| { type: "network"; cause: string; url: string }
	| { type: "http"; status: number; url: string }
	| { type: "browser_launch_failed"; stderr: string }
	| { type: "playwright_disconnected" }
	| { type: "aborted" }
	| { type: "config_invalid"; field: string; reason: string };

export class CamoufoxErrorBox extends Error {
	public readonly err: CamoufoxError;

	constructor(err: CamoufoxError) {
		super(`${err.type}: ${JSON.stringify(err)}`);
		this.name = "CamoufoxError";
		this.err = err;
	}
}

export interface MapContext {
	readonly url?: string;
	readonly phase?: "nav" | "wait_ready";
	readonly elapsedMs?: number;
	readonly signal?: AbortSignal;
}

const NETWORK_PATTERN = /net::ERR_|NS_ERROR_NET_|getaddrinfo/;

export function mapPlaywrightError(err: unknown, ctx: MapContext): CamoufoxError {
	if (ctx.signal?.aborted) {
		return { type: "aborted" };
	}
	if (!(err instanceof Error)) {
		throw err;
	}
	if (err.name === "AbortError") {
		return { type: "aborted" };
	}
	if (err.name === "TimeoutError") {
		return {
			type: "timeout",
			phase: ctx.phase ?? "nav",
			elapsedMs: ctx.elapsedMs ?? 0,
		};
	}
	if (NETWORK_PATTERN.test(err.message)) {
		return {
			type: "network",
			cause: err.message,
			url: ctx.url ?? "",
		};
	}
	throw err;
}
