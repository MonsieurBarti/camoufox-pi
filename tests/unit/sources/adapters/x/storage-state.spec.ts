import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CamoufoxErrorBox } from "../../../../../src/errors.js";
import {
	extractXCookies,
	parseStorageState,
} from "../../../../../src/sources/adapters/x/storage-state.js";

const fixture = readFileSync("tests/fixtures/x-storage-state.json", "utf8");

describe("parseStorageState", () => {
	it("parses valid JSON", () => {
		const state = parseStorageState(fixture);
		expect(state.cookies.length).toBe(3);
	});

	it("throws credential_invalid on malformed JSON", () => {
		try {
			parseStorageState("{not json");
			expect.fail("should throw");
		} catch (e) {
			expect(e).toBeInstanceOf(CamoufoxErrorBox);
			expect((e as CamoufoxErrorBox).err.type).toBe("credential_invalid");
		}
	});
});

describe("extractXCookies", () => {
	it("returns auth_token and ct0 when both present", () => {
		const state = parseStorageState(fixture);
		expect(extractXCookies(state)).toEqual({
			auth_token: "AUTH_FIXTURE",
			ct0: "CT0_FIXTURE",
		});
	});

	it("throws credential_invalid when auth_token missing", () => {
		const state = {
			cookies: [
				{
					name: "ct0",
					value: "x",
					domain: ".x.com",
					path: "/",
					expires: -1,
					httpOnly: false,
					secure: true,
					sameSite: "Lax" as const,
				},
			],
			origins: [],
		};
		expect(() => extractXCookies(state)).toThrow(CamoufoxErrorBox);
	});

	it("throws credential_invalid when ct0 missing", () => {
		const state = {
			cookies: [
				{
					name: "auth_token",
					value: "x",
					domain: ".x.com",
					path: "/",
					expires: -1,
					httpOnly: true,
					secure: true,
					sameSite: "Lax" as const,
				},
			],
			origins: [],
		};
		expect(() => extractXCookies(state)).toThrow(CamoufoxErrorBox);
	});

	it("throws credential_invalid on empty cookies", () => {
		expect(() => extractXCookies({ cookies: [], origins: [] })).toThrow(CamoufoxErrorBox);
	});

	it("ignores cookies on unrelated domains", () => {
		const state = {
			cookies: [
				{
					name: "auth_token",
					value: "SPOOF",
					domain: ".example.com",
					path: "/",
					expires: -1,
					httpOnly: true,
					secure: true,
					sameSite: "Lax" as const,
				},
				{
					name: "ct0",
					value: "SPOOF",
					domain: ".example.com",
					path: "/",
					expires: -1,
					httpOnly: false,
					secure: true,
					sameSite: "Lax" as const,
				},
			],
			origins: [],
		};
		expect(() => extractXCookies(state)).toThrow(CamoufoxErrorBox);
	});
});
