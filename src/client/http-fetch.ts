import { CamoufoxErrorBox } from "../errors.js";
import type { LookupFn } from "../security/ssrf.js";
import { assertSafeTarget } from "../security/ssrf.js";
import type { HttpFetchEvent } from "./events.js";

export interface HttpFetchInit {
	readonly method?: "GET" | "POST";
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly signal?: AbortSignal;
	readonly maxBytes?: number;
	readonly timeoutMs?: number;
}

export interface HttpResponse {
	readonly status: number;
	/** Lowercased header names. HTTP headers are case-insensitive; this
	 * normalization is stable so adapters can look up e.g. "retry-after". */
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
	readonly url: string;
}

export type HttpFetch = (url: string, init?: HttpFetchInit) => Promise<HttpResponse>;

export interface CreateHttpFetchOptions {
	readonly lookup?: LookupFn;
	readonly fetchImpl?: typeof fetch;
	readonly emit?: (e: HttpFetchEvent) => void;
	readonly spanIdFor?: () => string;
	readonly source?: string;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export function createHttpFetch(opts: CreateHttpFetchOptions): HttpFetch {
	const fetchImpl = opts.fetchImpl ?? fetch;
	return async (url: string, init: HttpFetchInit = {}): Promise<HttpResponse> => {
		// SSRF + scheme check on initial URL. Redirects are handled in the next
		// task and each hop re-validates.
		try {
			await assertSafeTarget(url, opts.lookup ? { lookup: opts.lookup } : {});
		} catch (err) {
			throw new CamoufoxErrorBox({
				type: "ssrf_blocked",
				hop: "initial",
				url,
				reason: err instanceof Error ? err.message : String(err),
			});
		}
		const maxBytes = init.maxBytes ?? DEFAULT_MAX_BYTES;
		const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const combinedSignal = init.signal
			? AbortSignal.any([init.signal, controller.signal])
			: controller.signal;
		const start = Date.now();
		try {
			const res = await fetchImpl(url, {
				method: init.method ?? "GET",
				...(init.headers !== undefined ? { headers: init.headers } : {}),
				...(init.body !== undefined ? { body: init.body } : {}),
				signal: combinedSignal,
				redirect: "manual",
			});
			// Redirects are handled in Task 5. For Task 4, a 3xx surfaces as-is.
			const body = await readBodyLimited(res, maxBytes);
			const headers = headersToRecord(res.headers);
			const response: HttpResponse = {
				status: res.status,
				headers,
				body,
				url: res.url || url,
			};
			opts.emit?.({
				spanId: opts.spanIdFor?.() ?? "",
				...(opts.source !== undefined ? { source: opts.source } : {}),
				url,
				status: res.status,
				durationMs: Date.now() - start,
			});
			return response;
		} catch (err) {
			// Tie-break: if both the internal timer and external signal fired, the
			// external cancellation wins (aborted) — checked via init.signal.aborted.
			if (combinedSignal.aborted && !init.signal?.aborted) {
				throw new CamoufoxErrorBox({
					type: "timeout",
					phase: "nav",
					elapsedMs: Date.now() - start,
				});
			}
			if (init.signal?.aborted) {
				throw new CamoufoxErrorBox({ type: "aborted" });
			}
			throw new CamoufoxErrorBox({
				type: "network",
				cause: err instanceof Error ? err.message : String(err),
				url,
			});
		} finally {
			clearTimeout(timer);
		}
	};
}

async function readBodyLimited(res: Response, maxBytes: number): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) return "";
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (total < maxBytes) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		const remaining = maxBytes - total;
		if (value.byteLength > remaining) {
			chunks.push(value.subarray(0, remaining));
			total += remaining;
			await reader.cancel().catch(() => undefined);
			break;
		}
		chunks.push(value);
		total += value.byteLength;
	}
	// Concatenate, then UTF-8 decode. `fatal: false` means invalid sequences
	// become U+FFFD — safer than throwing at an arbitrary byte boundary.
	const merged = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		merged.set(c, offset);
		offset += c.byteLength;
	}
	return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

function headersToRecord(h: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	h.forEach((v, k) => {
		out[k.toLowerCase()] = v;
	});
	return out;
}
