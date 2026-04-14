import type { CamoufoxError } from "../errors.js";

export function formatAgentMessage(err: CamoufoxError): string {
	switch (err.type) {
		case "session_expired":
			return `Your ${err.source} session has expired. Run \`camoufox-pi setup --refresh ${err.source}\` to log in again.`;
		case "credential_missing":
			return `Missing credential \`${err.credentialKey}\` for source \`${err.source}\`. Run \`camoufox-pi setup\` to configure it.`;
		case "credential_invalid":
			return `Stored credential \`${err.credentialKey}\` for source \`${err.source}\` is invalid. Run \`camoufox-pi setup --refresh ${err.source}\` (cookie_jar) or \`camoufox-pi setup\` to re-enter it.`;
		default:
			return `${err.type}${"source" in err && err.source ? ` (source: ${err.source})` : ""}`;
	}
}
