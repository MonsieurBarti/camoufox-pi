import type { CamoufoxConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";
import { CamoufoxClient } from "./camoufox-client.js";
import { type Launcher, RealLauncher } from "./launcher.js";

export interface CreateClientOptions {
	readonly config?: Partial<CamoufoxConfig>;
	readonly launcher?: Launcher;
}

/**
 * Factory for library-mode consumers. Constructs a CamoufoxClient with
 * either an injected launcher or a RealLauncher, shallow-merges config
 * over DEFAULT_CONFIG, and fires ensureReady() in the background. First op
 * awaits the in-flight launch promise via ensureReady.
 *
 * Returns synchronously. Factory caller that wants eager behavior writes
 * `const c = createClient(); await c.ensureReady();` — one explicit line.
 */
export function createClient(opts: CreateClientOptions = {}): CamoufoxClient {
	const launcher = opts.launcher ?? new RealLauncher();
	const config: CamoufoxConfig = { ...DEFAULT_CONFIG, ...opts.config };
	const client = new CamoufoxClient({ launcher, config });
	// Fire-and-forget: first op awaits the in-flight promise via ensureReady.
	client.ensureReady().catch(() => undefined);
	return client;
}
