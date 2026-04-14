import { describe, expect, it } from "vitest";
import { makeFakeLauncher } from "../../helpers/fake-launcher.js";

describe("FakeLauncher capture-flow extensions", () => {
	it("exposes context.storageState() returning a configured value", async () => {
		const launcher = makeFakeLauncher({
			storageState: { cookies: [], origins: [] },
		});
		const launched = await launcher.launch();
		const state = await launched.context.storageState();
		expect(state).toEqual({ cookies: [], origins: [] });
	});

	it("supports context.once('close') firing when closeContext() is called", async () => {
		const launcher = makeFakeLauncher({});
		const launched = await launcher.launch();
		let fired = false;
		launched.context.once("close", () => {
			fired = true;
		});
		await launched.context.close();
		expect(fired).toBe(true);
	});

	it("page.waitForURL resolves when the injected URL matches the pattern", async () => {
		const launcher = makeFakeLauncher({});
		const launched = await launcher.launch();
		const page = await launched.context.newPage();
		const waiter = page.waitForURL(/^https:\/\/example\.test\/home/);
		(launched.context as unknown as { __setPageUrl(u: string): void }).__setPageUrl(
			"https://example.test/home",
		);
		await expect(waiter).resolves.toBeUndefined();
	});
});
