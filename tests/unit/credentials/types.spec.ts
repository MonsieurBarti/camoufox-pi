import { describe, expect, it } from "vitest";
import type { CredentialSpec } from "../../../src/credentials/types.js";

describe("CredentialSpec cookie_jar", () => {
	it("accepts an optional loggedInUrlPattern RegExp", () => {
		const spec: CredentialSpec = {
			kind: "cookie_jar",
			key: "cookies",
			description: "X session cookies",
			loginUrl: "https://x.com/login",
			loggedInUrlPattern: /^https:\/\/x\.com\/home/,
		};
		expect(spec.loggedInUrlPattern?.test("https://x.com/home")).toBe(true);
	});

	it("remains valid without loggedInUrlPattern", () => {
		const spec: CredentialSpec = {
			kind: "cookie_jar",
			key: "cookies",
			description: "X session cookies",
			loginUrl: "https://x.com/login",
		};
		expect(spec.loggedInUrlPattern).toBeUndefined();
	});
});
