import { type SourceFetchEvent, newSpanId } from "../client/events.js";
import type { HttpFetch } from "../client/http-fetch.js";
import type { CredentialBackend } from "../credentials/backend.js";
import { createCredentialReader } from "../credentials/reader.js";
import { type CamoufoxError, CamoufoxErrorBox } from "../errors.js";
import { sortByPublishedDesc } from "./source-item.js";
import type { SourceItem } from "./source-item.js";
import type { AdapterContext, FetchSourcesResult, SourceAdapter, SourceName } from "./types.js";

export interface FetchSourcesOptions {
	readonly sources: readonly SourceName[];
	readonly lookbackDays: number;
	readonly perSourceLimit: number;
	readonly adapters: readonly SourceAdapter[];
	readonly credentialBackend: CredentialBackend;
	readonly httpFetch: HttpFetch;
	readonly emit: (event: SourceFetchEvent) => void;
	readonly signal?: AbortSignal;
}

export async function fetchSources(
	query: string,
	opts: FetchSourcesOptions,
): Promise<FetchSourcesResult> {
	if (opts.sources.length === 0) {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "sources",
			reason: "at least one source is required",
		});
	}

	const adapterByName = new Map<SourceName, SourceAdapter>();
	for (const a of opts.adapters) adapterByName.set(a.name, a);

	const unknown = opts.sources.filter((s) => !adapterByName.has(s));
	if (unknown.length > 0) {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "sources",
			reason: `unknown sources: ${unknown.join(", ")}`,
		});
	}

	const results = await Promise.allSettled(
		opts.sources.map((name) =>
			runOneSource(query, name, adapterByName.get(name) as SourceAdapter, opts),
		),
	);

	const items: SourceItem[] = [];
	const errors: FetchSourcesResult["errors"] = [];
	const stats: FetchSourcesResult["stats"] = [];

	for (let i = 0; i < results.length; i++) {
		const name = opts.sources[i] as SourceName;
		const adapter = adapterByName.get(name) as SourceAdapter;
		const r = results[i];
		if (r && r.status === "fulfilled") {
			items.push(...r.value.items);
			stats.push({
				source: name,
				itemCount: r.value.items.length,
				durationMs: r.value.durationMs,
				tier: adapter.tier,
			});
		} else {
			const err = (r as PromiseRejectedResult).reason;
			const cfxErr: CamoufoxError =
				err instanceof CamoufoxErrorBox
					? err.err
					: { type: "source_unavailable", source: name, cause: String(err) };
			errors.push({ source: name, error: cfxErr });
			stats.push({
				source: name,
				itemCount: 0,
				durationMs: 0,
				tier: adapter.tier,
			});
		}
	}

	if (errors.length === opts.sources.length) {
		throw new CamoufoxErrorBox({
			type: "all_sources_failed",
			errors: errors.map((e) => ({ source: e.source, error: e.error })),
		});
	}

	return {
		items: sortByPublishedDesc(items),
		errors,
		stats,
	};
}

interface OneSourceResult {
	items: readonly SourceItem[];
	durationMs: number;
}

async function runOneSource(
	query: string,
	name: SourceName,
	adapter: SourceAdapter,
	opts: FetchSourcesOptions,
): Promise<OneSourceResult> {
	const reader = createCredentialReader(opts.credentialBackend, name);
	const ctx: AdapterContext = {
		httpFetch: opts.httpFetch,
		credentials: reader,
		emit: opts.emit,
	};
	const start = Date.now();
	const spanId = newSpanId();
	try {
		const fetchOpts = {
			lookbackDays: opts.lookbackDays,
			limit: opts.perSourceLimit,
			...(opts.signal !== undefined ? { signal: makeDerivedSignal(opts.signal) } : {}),
		};

		const items = await adapter.fetch(query, fetchOpts, ctx);
		const durationMs = Date.now() - start;
		opts.emit({
			spanId,
			source: name,
			query,
			tier: adapter.tier,
			outcome: "ok",
			itemCount: items.length,
			durationMs,
		});
		return { items, durationMs };
	} catch (err) {
		const durationMs = Date.now() - start;
		const cfxErr: CamoufoxError =
			err instanceof CamoufoxErrorBox
				? err.err
				: { type: "source_unavailable", source: name, cause: String(err) };
		opts.emit({
			spanId,
			source: name,
			query,
			tier: adapter.tier,
			outcome: "error",
			itemCount: 0,
			durationMs,
			error: cfxErr,
		});
		throw err;
	}
}

/**
 * Returns a derived AbortSignal that mirrors the parent. When the parent is
 * already aborted, calling addEventListener("abort", …) on the derived signal
 * will fire the listener synchronously — closing the gap that exists in some
 * runtimes (e.g. Bun) where registering a listener on an already-aborted
 * signal never fires the event.
 */
function makeDerivedSignal(parent: AbortSignal): AbortSignal {
	if (!parent.aborted) {
		// Fast path: parent is live — AbortSignal.any handles forwarding.
		return AbortSignal.any([parent]);
	}
	// Slow path: already aborted. Wrap with a Proxy so addEventListener fires
	// the callback immediately when the signal is already aborted.
	const controller = new AbortController();
	controller.abort(parent.reason);
	const signal = controller.signal;
	return new Proxy(signal, {
		get(target, prop) {
			if (prop === "addEventListener") {
				return (
					type: string,
					listener: ((...args: unknown[]) => void) | { handleEvent: (...args: unknown[]) => void },
					options?: unknown,
				) => {
					if (type === "abort") {
						const cb =
							typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
						// Fire immediately since the signal is already aborted.
						cb(new Event("abort"));
						return;
					}
					return (target.addEventListener as (...a: unknown[]) => void)(type, listener, options);
				};
			}
			const val = Reflect.get(target, prop, target);
			return typeof val === "function" ? val.bind(target) : val;
		},
	});
}
