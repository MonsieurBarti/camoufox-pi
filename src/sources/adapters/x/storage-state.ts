import { CamoufoxErrorBox } from "../../../errors.js";

export interface StorageStateCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None";
}

export interface StorageState {
	cookies: StorageStateCookie[];
	origins: unknown[];
}

export function parseStorageState(json: string): StorageState {
	try {
		const parsed = JSON.parse(json);
		if (!parsed || !Array.isArray(parsed.cookies)) {
			throw new Error("missing cookies[]");
		}
		return parsed as StorageState;
	} catch {
		throw new CamoufoxErrorBox({
			type: "credential_invalid",
			source: "x",
			credentialKey: "cookies",
		});
	}
}

const X_DOMAINS = [".x.com", ".twitter.com"];

function matchesXDomain(domain: string): boolean {
	const d = domain.toLowerCase();
	return X_DOMAINS.some((suffix) => d === suffix || d.endsWith(suffix));
}

export function extractXCookies(state: StorageState): {
	auth_token: string;
	ct0: string;
} {
	let authToken: string | undefined;
	let ct0: string | undefined;
	for (const c of state.cookies) {
		if (!matchesXDomain(c.domain)) continue;
		if (c.name === "auth_token") authToken = c.value;
		else if (c.name === "ct0") ct0 = c.value;
	}
	if (!authToken || !ct0) {
		throw new CamoufoxErrorBox({
			type: "credential_invalid",
			source: "x",
			credentialKey: "cookies",
		});
	}
	return { auth_token: authToken, ct0 };
}
