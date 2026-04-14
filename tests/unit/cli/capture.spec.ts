import { describe, expect, it } from "vitest";
import { captureCookieJar } from "../../../src/cli/capture.js";
import { makeFakeLauncher } from "../../helpers/fake-launcher.js";

describe("captureCookieJar — Enter wins", () => {
	it("serializes storageState when the user presses Enter", async () => {
		const launcher = makeFakeLauncher({
			storageState: {
				cookies: [
					{
						name: "auth_token",
						value: "abc",
						domain: ".x.com",
						path: "/",
						expires: -1,
						httpOnly: true,
						secure: true,
						sameSite: "Lax",
					},
				],
				origins: [],
			},
		});
		const log: string[] = [];
		const result = await captureCookieJar({
			source: "x",
			loginUrl: "https://x.com/login",
			launcher,
			log: (l) => log.push(l),
			promptLine: async () => "",
		});
		expect(JSON.parse(result.storageStateJson)).toEqual({
			cookies: [expect.objectContaining({ name: "auth_token", value: "abc" })],
			origins: [],
		});
		expect(log.join("\n")).toContain("https://x.com/login");
	});
});
