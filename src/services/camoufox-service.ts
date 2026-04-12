import { CamoufoxClient } from "../client/camoufox-client.js";
import type { Launcher } from "../client/launcher.js";
import type { CamoufoxConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";

// Owns the singleton CamoufoxClient for one PI session.
// Lifecycle: initialize (kicks off ensureReady without awaiting) / shutdown
// (closes the client). Spec: §2, §3.1.
export class CamoufoxService {
	private readonly config: CamoufoxConfig;
	private readonly launcherFactory: () => Launcher;
	private basePath: string | null = null;
	private client: CamoufoxClient | null = null;

	constructor(opts?: { config?: CamoufoxConfig; launcherFactory?: () => Launcher }) {
		this.config = opts?.config ?? DEFAULT_CONFIG;
		this.launcherFactory =
			opts?.launcherFactory ??
			(() => {
				throw new Error(
					"CamoufoxService requires a launcherFactory. In production, src/index.ts wires a RealLauncher. In tests, inject a fake.",
				);
			});
	}

	async initialize(cwd: string, _signal?: AbortSignal): Promise<void> {
		this.basePath = cwd;
		const launcher = this.launcherFactory();
		this.client = new CamoufoxClient({ launcher, config: this.config });
		// Fire-and-forget: kick off launch but do not await. First tool call
		// awaits the same in-flight promise via client.ensureReady().
		this.client.ensureReady().catch(() => {
			// Swallow — failure is sticky and surfaces on the first tool call.
		});
	}

	async shutdown(): Promise<void> {
		const client = this.client;
		this.client = null;
		this.basePath = null;
		if (client) await client.close();
	}

	getConfig(): CamoufoxConfig {
		return this.config;
	}

	getBasePath(): string | null {
		return this.basePath;
	}

	getClient(): CamoufoxClient {
		if (!this.client) {
			throw new Error("CamoufoxService.getClient() called before initialize()");
		}
		return this.client;
	}
}
