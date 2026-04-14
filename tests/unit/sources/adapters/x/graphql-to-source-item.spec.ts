import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type BirdSearchRow,
	toSourceItem,
	withinLookback,
} from "../../../../../src/sources/adapters/x/graphql-to-source-item.js";

const rows = JSON.parse(
	readFileSync("tests/fixtures/x-graphql-search.json", "utf8"),
) as BirdSearchRow[];

describe("toSourceItem", () => {
	it("maps a standard row", () => {
		// biome-ignore lint/style/noNonNullAssertion: fixture is known to have at least 1 row
		const item = toSourceItem(rows[0]!);
		expect(item.source).toBe("x");
		expect(item.id).toBe("1700000000000000000");
		expect(item.url).toBe("https://x.com/rustacean/status/1700000000000000000");
		expect(item.title).toBeNull();
		expect(item.text).toContain("Rust async");
		expect(item.author).toBe("rustacean");
		expect(new Date(item.publishedAt).toISOString()).toBe("2026-04-01T12:00:00.000Z");
		expect(item.engagement.score).toBe(42);
		expect(item.engagement.comments).toBe(3);
		expect(item.engagement.shares).toBe(7);
	});

	it("omits engagement keys when counters are absent", () => {
		// biome-ignore lint/style/noNonNullAssertion: fixture is known to have at least 3 rows
		const item = toSourceItem(rows[2]!);
		expect(item.engagement.score).toBeUndefined();
		expect(item.engagement.comments).toBeUndefined();
		expect(item.engagement.shares).toBeUndefined();
	});

	it("keeps empty text as empty string, not null", () => {
		// biome-ignore lint/style/noNonNullAssertion: fixture is known to have at least 3 rows
		const item = toSourceItem(rows[2]!);
		expect(item.text).toBe("");
	});
});

describe("withinLookback", () => {
	const now = new Date("2026-04-14T00:00:00Z").getTime();

	it("keeps items inside the window", () => {
		expect(withinLookback("2026-04-01T12:00:00.000Z", 30, now)).toBe(true);
	});

	it("drops items outside the window", () => {
		expect(withinLookback("2026-03-10T09:30:00.000Z", 30, now)).toBe(false);
	});

	it("treats boundary as inclusive", () => {
		const iso = new Date(now - 30 * 86_400_000).toISOString();
		expect(withinLookback(iso, 30, now)).toBe(true);
	});
});
