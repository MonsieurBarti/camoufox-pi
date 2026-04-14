import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createCredentialReader } from "../../../../../src/credentials/reader.js";
import { CamoufoxErrorBox } from "../../../../../src/errors.js";
import { xAdapter } from "../../../../../src/sources/adapters/x.js";
import { createFakeCredentialBackend } from "../../../../helpers/fake-credential-backend.js";
import { createFakeHttpFetch } from "../../../../helpers/fake-http-fetch.js";

const storageFixture = readFileSync("tests/fixtures/x-storage-state.json", "utf8");

vi.mock("../../../../../src/sources/adapters/x/bird-search-shim.js", () => ({
	runBirdSearch: vi.fn(async () => [
		{
			id: "1",
			text: "hi",
			createdAt: new Date().toUTCString(),
			author: { username: "alice", name: "Alice" },
			authorId: "42",
			likeCount: 1,
			replyCount: 0,
			retweetCount: 0,
		},
	]),
}));

describe("xAdapter", () => {
	it("declares a cookie_jar credential with a loggedInUrlPattern", () => {
		const a = xAdapter();
		expect(a.name).toBe("x");
		expect(a.tier).toBe(2);
		expect(a.requiredCredentials[0]?.kind).toBe("cookie_jar");
		expect(a.requiredCredentials[0]?.loggedInUrlPattern).toBeInstanceOf(RegExp);
	});

	it("throws credential_missing when no cookies stored", async () => {
		const backend = createFakeCredentialBackend();
		const credentials = createCredentialReader(backend, "x");
		try {
			await xAdapter().fetch(
				"q",
				{ lookbackDays: 30, limit: 25 },
				{ httpFetch: createFakeHttpFetch({}), credentials, emit: () => {} },
			);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CamoufoxErrorBox);
			expect((err as CamoufoxErrorBox).err.type).toBe("credential_missing");
		}
	});

	it("fetches items and filters by lookback", async () => {
		const backend = createFakeCredentialBackend();
		await backend.set("camoufox-pi:x:cookies", storageFixture);
		const credentials = createCredentialReader(backend, "x");
		const items = await xAdapter().fetch(
			"rust",
			{ lookbackDays: 30, limit: 25 },
			{ httpFetch: createFakeHttpFetch({}), credentials, emit: () => {} },
		);
		expect(items.length).toBe(1);
		expect(items[0]?.source).toBe("x");
	});
});
