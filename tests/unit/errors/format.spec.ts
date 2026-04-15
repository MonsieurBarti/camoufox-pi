import { describe, expect, it } from "vitest";
import { formatAgentMessage } from "../../../src/errors/format.js";

describe("formatAgentMessage", () => {
	it("formats session_expired with a --refresh hint", () => {
		const msg = formatAgentMessage({
			type: "session_expired",
			source: "x",
			credentialKey: "cookies",
		});
		expect(msg).toMatch(/x session/i);
		expect(msg).toMatch(/setup --refresh x/);
	});

	it("formats credential_missing with a setup hint", () => {
		const msg = formatAgentMessage({
			type: "credential_missing",
			source: "reddit",
			credentialKey: "oauth_token",
		});
		expect(msg).toMatch(/reddit/i);
		expect(msg).toMatch(/credential/i);
		expect(msg).toMatch(/setup/i);
	});

	it("falls back to a type-labeled summary for uncovered variants", () => {
		const msg = formatAgentMessage({
			type: "source_rate_limited",
			source: "x",
			retryAfterSec: 30,
		});
		expect(msg).toMatch(/source_rate_limited/);
		expect(msg).toMatch(/x/);
	});
});
