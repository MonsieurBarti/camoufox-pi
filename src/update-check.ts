/**
 * Update check for Camoufox-PI extension
 *
 * Fetches the latest version from npm registry and compares with current version
 * to notify users when an update is available.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PACKAGE_NAME = "@the-forge-flow/camoufox-pi";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

export interface UpdateInfo {
	currentVersion: string;
	latestVersion: string;
	updateAvailable: boolean;
}

/**
 * Read current version from package.json
 */
function getCurrentVersion(): string {
	try {
		const packageJsonPath = join(__dirname, "..", "package.json");
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
		return packageJson.version || "0.0.0";
	} catch {
		return "0.0.0";
	}
}

/**
 * Compare semantic versions (returns true if latest > current)
 */
function compareVersions(current: string, latest: string): boolean {
	const cleanVersion = (v: string) => v.replace(/^v/, "");
	const currentParts = cleanVersion(current).split(".").map(Number);
	const latestParts = cleanVersion(latest).split(".").map(Number);

	for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
		const curr = currentParts[i] || 0;
		const lat = latestParts[i] || 0;
		if (lat > curr) return true;
		if (lat < curr) return false;
	}
	return false;
}

/**
 * Fetch latest version from npm registry using native fetch.
 * No subprocess spawn needed - faster and works everywhere.
 */
async function fetchLatestVersion(): Promise<string | null> {
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 2000);

		const response = await fetch(REGISTRY_URL, {
			signal: controller.signal,
			headers: { Accept: "application/json" },
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as { version?: string };
		return data.version ?? null;
	} catch {
		// Silently fail - update check is not critical
		return null;
	}
}

/**
 * Check if an update is available
 * Returns null if check fails (silently)
 */
export async function checkForUpdates(_pi: unknown): Promise<UpdateInfo | null> {
	const currentVersion = getCurrentVersion();
	const latestVersion = await fetchLatestVersion();

	if (!latestVersion) {
		return null;
	}

	const updateAvailable = compareVersions(currentVersion, latestVersion);

	return {
		currentVersion,
		latestVersion,
		updateAvailable,
	};
}
