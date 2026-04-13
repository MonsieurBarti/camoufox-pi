import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import type { CamoufoxError } from "../errors.js";

export interface SearchEvent {
	readonly spanId: string;
	readonly engine: "duckduckgo";
	readonly query: string;
	readonly maxResults: number;
	readonly durationMs: number;
	readonly resultCount: number;
	readonly atLimit: boolean;
}

export interface FetchUrlEvent {
	readonly spanId: string;
	readonly url: string;
	readonly finalUrl: string;
	readonly status: number;
	readonly bytes: number;
	readonly truncated: boolean;
	readonly isolate: boolean;
	readonly durationMs: number;
	readonly renderMode: "static" | "render" | "render-and-wait";
	readonly usedWaitForSelector: boolean;
	readonly usedSelector: boolean;
	readonly format: "html" | "markdown";
	readonly screenshotBytes: number | null;
}

export interface BrowserLaunchEvent {
	readonly spanId: string;
	readonly browserVersion: string;
	readonly durationMs: number;
}

export interface BinaryDownloadProgressEvent {
	readonly bytesDownloaded: number;
	readonly bytesTotal: number | null;
}

export interface ErrorEvent {
	readonly spanId: string | null;
	readonly op: "ensureReady" | "fetchUrl" | "search" | "checkHealth";
	readonly error: CamoufoxError;
}

export interface CamoufoxEvents {
	search: (e: SearchEvent) => void;
	fetch_url: (e: FetchUrlEvent) => void;
	browser_launch: (e: BrowserLaunchEvent) => void;
	binary_download_progress: (e: BinaryDownloadProgressEvent) => void;
	error: (e: ErrorEvent) => void;
}

export interface CamoufoxEventEmitter {
	on<K extends keyof CamoufoxEvents>(event: K, listener: CamoufoxEvents[K]): this;
	off<K extends keyof CamoufoxEvents>(event: K, listener: CamoufoxEvents[K]): this;
	once<K extends keyof CamoufoxEvents>(event: K, listener: CamoufoxEvents[K]): this;
	emit<K extends keyof CamoufoxEvents>(
		event: K,
		payload: Parameters<CamoufoxEvents[K]>[0],
	): boolean;
	listenerCount(event: keyof CamoufoxEvents): number;
}

export function createEventEmitter(): CamoufoxEventEmitter {
	const ee = new EventEmitter();
	// Listener errors are logged via console.error but do NOT propagate —
	// they must never mask a CamoufoxErrorBox re-thrown to the caller.
	ee.on("error", () => undefined);
	// Listener isolation: a listener that throws (sync or async) must not mask
	// a CamoufoxErrorBox re-thrown to the caller, nor bring down other
	// listeners. Each registration is assumed to use a unique function
	// reference — re-registering the same reference via both on() and once()
	// would collide in the WeakMap below. Support isn't needed in practice.
	const wrap =
		<K extends keyof CamoufoxEvents>(listener: CamoufoxEvents[K]) =>
		(payload: Parameters<CamoufoxEvents[K]>[0]) => {
			try {
				const result = (listener as (p: Parameters<CamoufoxEvents[K]>[0]) => unknown)(payload);
				if (result && typeof (result as Promise<unknown>).then === "function") {
					(result as Promise<unknown>).catch((err) => {
						console.error("[camoufox] async event listener rejected:", err);
					});
				}
			} catch (err) {
				console.error("[camoufox] event listener threw:", err);
			}
		};
	// Keep a map so off() can find the wrapper.
	const wrapped = new WeakMap<(...a: unknown[]) => void, (...a: unknown[]) => void>();
	return {
		on(event, listener) {
			const w = wrap(listener);
			wrapped.set(listener as unknown as (...a: unknown[]) => void, w as (...a: unknown[]) => void);
			ee.on(event, w);
			return this;
		},
		off(event, listener) {
			const w = wrapped.get(listener as unknown as (...a: unknown[]) => void);
			if (w) ee.off(event, w);
			return this;
		},
		once(event, listener) {
			const w = wrap(listener);
			wrapped.set(listener as unknown as (...a: unknown[]) => void, w as (...a: unknown[]) => void);
			ee.once(event, w);
			return this;
		},
		emit(event, payload) {
			return ee.emit(event, payload);
		},
		listenerCount(event) {
			return ee.listenerCount(event);
		},
	};
}

export function newSpanId(): string {
	return randomUUID().replace(/-/g, "").slice(0, 16);
}
