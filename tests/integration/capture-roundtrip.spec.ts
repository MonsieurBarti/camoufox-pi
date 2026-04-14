import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureCookieJar } from "../../src/cli/capture.js";
import { RealLauncher } from "../../src/client/launcher.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
	server = createServer((req, res) => {
		if (req.url === "/login") {
			res.setHeader("set-cookie", [
				"auth_token=INTEGRATION_A; Path=/",
				"ct0=INTEGRATION_C; Path=/",
			]);
			res.statusCode = 302;
			res.setHeader("location", "/home");
			res.end();
		} else if (req.url === "/home") {
			res.setHeader("content-type", "text/html; charset=utf-8");
			res.end("<html><body>logged in</body></html>");
		} else {
			res.statusCode = 404;
			res.end();
		}
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const port = (server.address() as AddressInfo).port;
	baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(
	() =>
		new Promise<void>((resolve) => {
			server.close(() => resolve());
		}),
);

describe("captureCookieJar integration (headless)", () => {
	it("captures cookies after URL watcher fires", async () => {
		const result = await captureCookieJar({
			source: "x",
			loginUrl: `${baseUrl}/login`,
			loggedInUrlPattern: /\/home$/,
			launcher: new RealLauncher({ headless: true }),
			log: () => {},
			promptLine: () => new Promise<string>(() => {}),
		});
		const state = JSON.parse(result.storageStateJson) as {
			cookies: Array<{ name: string; value: string }>;
		};
		const auth = state.cookies.find((c) => c.name === "auth_token");
		const ct0 = state.cookies.find((c) => c.name === "ct0");
		expect(auth?.value).toBe("INTEGRATION_A");
		expect(ct0?.value).toBe("INTEGRATION_C");
	}, 120_000);
});
