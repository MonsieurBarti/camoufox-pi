// Intercepts every document-type request (main-frame initial, main-frame
// redirect, subframe) via Playwright page.route and re-runs assertSafeTarget.
// On any unsafe hop, records a BlockedHop and aborts the request with
// "blockedbyclient". navigate() polls getBlockedHop() after page.goto to
// convert the block into an ssrf_blocked throw.
// Spec: docs/superpowers/specs/2026-04-13-redirect-ssrf-design.md §4.

import type { Page, Request, Route } from "playwright-core";

import { type LookupFn, assertSafeTarget } from "./ssrf.js";

export interface BlockedHop {
	hop: "initial" | "redirect" | "subframe";
	url: string;
	reason: string;
}

export interface SsrfGuard {
	detach(): Promise<void>;
	getBlockedHop(): BlockedHop | null;
}

function classifyHop(
	request: Pick<Request, "frame" | "isNavigationRequest" | "redirectedFrom">,
	mainFrame: unknown,
): "initial" | "redirect" | "subframe" {
	const sameFrame = request.frame() === mainFrame;
	if (sameFrame && request.isNavigationRequest()) {
		return request.redirectedFrom() === null ? "initial" : "redirect";
	}
	return "subframe";
}

export async function attachSsrfGuard(
	page: Page,
	opts: { lookup?: LookupFn } = {},
): Promise<SsrfGuard> {
	let blockedHop: BlockedHop | null = null;
	const mainFrame = page.mainFrame();

	const handler = async (route: Route, request: Request): Promise<void> => {
		// Pass through non-document requests (images, scripts, XHR, CSS, …).
		// Scope is main-frame + subframe document navigation only (spec §4.3).
		if (request.resourceType() !== "document") {
			await route.continue();
			return;
		}
		const url = request.url();
		try {
			await assertSafeTarget(url, opts.lookup ? { lookup: opts.lookup } : {});
			await route.continue();
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			if (blockedHop === null) {
				blockedHop = {
					hop: classifyHop(request, mainFrame),
					url,
					reason,
				};
			}
			await route.abort("blockedbyclient");
		}
	};

	await page.route("**/*", handler);

	let detached = false;
	return {
		async detach() {
			if (detached) return;
			detached = true;
			await page.unroute("**/*", handler);
		},
		getBlockedHop() {
			return blockedHop;
		},
	};
}
