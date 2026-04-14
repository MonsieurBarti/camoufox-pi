#!/usr/bin/env node

export type CliHandler = () => Promise<number>;

export interface RunCliDeps {
	readonly handlers: Partial<Record<string, CliHandler>>;
	readonly log: (line: string) => void;
}

const USAGE = `camoufox-pi — stealth browser + source adapters

Usage:
  camoufox-pi <command> [options]

Commands:
  setup              Audit and configure source credentials
  setup --check              Audit only, nonzero exit if any credential missing
  setup --refresh <source>   Re-capture cookie_jar credentials for a source

Options:
  --help             Show this message`;

export async function runCli(argv: readonly string[], deps: RunCliDeps): Promise<number> {
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "help") {
		deps.log(USAGE);
		return 0;
	}
	const [cmd, ...rest] = argv;
	if (cmd === "setup") {
		const hasCheck = rest.includes("--check");
		const refreshIdx = rest.indexOf("--refresh");
		const hasRefresh = refreshIdx >= 0;

		if (hasCheck && hasRefresh) {
			deps.log("--check and --refresh are mutually exclusive");
			return 2;
		}

		if (hasRefresh) {
			const source = rest[refreshIdx + 1];
			if (!source || source.startsWith("--")) {
				deps.log("--refresh requires a source argument");
				return 2;
			}
			const handler = deps.handlers[`setup:refresh:${source}`];
			if (!handler) {
				deps.log(`unknown source: ${source}`);
				return 2;
			}
			return handler();
		}

		if (hasCheck) {
			const handler = deps.handlers["setup:check"];
			if (!handler) {
				deps.log("setup:check not wired");
				return 1;
			}
			return handler();
		}

		const handler = deps.handlers.setup;
		if (!handler) {
			deps.log("setup not wired");
			return 1;
		}
		return handler();
	}
	deps.log(`unknown command: ${cmd}\n\n${USAGE}`);
	return 2;
}

// Allow invocation as `node dist/cli/index.js setup`.
if (import.meta.url === `file://${process.argv[1]}`) {
	const { registerSetupHandlers } = await import("./setup.js");
	const handlers = registerSetupHandlers() as Partial<Record<string, CliHandler>>;
	runCli(process.argv.slice(2), { handlers, log: (l) => console.log(l) }).then(
		(code) => process.exit(code),
		(err) => {
			console.error(err);
			process.exit(1);
		},
	);
}
