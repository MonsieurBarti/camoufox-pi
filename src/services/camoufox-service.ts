import type { CamoufoxConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";

// Skeleton service. Lifecycle-compatible with fff-pi's FffService shape
// (initialize / shutdown) so the PI extension entry can wire it up today.
// Real browser-pool/fetch/search methods land as implementation proceeds
// per docs/SPEC.md.
export class CamoufoxService {
	private readonly config: CamoufoxConfig;
	private basePath: string | null = null;

	constructor(config: CamoufoxConfig = DEFAULT_CONFIG) {
		this.config = config;
	}

	async initialize(cwd: string, _signal?: AbortSignal): Promise<void> {
		this.basePath = cwd;
	}

	async shutdown(): Promise<void> {
		this.basePath = null;
	}

	getConfig(): CamoufoxConfig {
		return this.config;
	}

	getBasePath(): string | null {
		return this.basePath;
	}
}
