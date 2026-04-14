import type { SourceItem } from "../../source-item.js";

export interface BirdSearchRow {
	id: string;
	created_at: string;
	full_text?: string;
	text?: string;
	user: { screen_name: string; name: string | null } | null;
	favorite_count?: number;
	reply_count?: number;
	retweet_count?: number;
}

export function toSourceItem(row: BirdSearchRow): SourceItem {
	const screenName = row.user?.screen_name ?? "i";
	const body = row.full_text ?? row.text ?? "";
	return {
		source: "x",
		id: row.id,
		url: `https://x.com/${screenName}/status/${row.id}`,
		title: null,
		text: body,
		author: row.user?.screen_name ?? null,
		publishedAt: new Date(row.created_at).toISOString(),
		engagement: {
			...(typeof row.favorite_count === "number" ? { score: row.favorite_count } : {}),
			...(typeof row.reply_count === "number" ? { comments: row.reply_count } : {}),
			...(typeof row.retweet_count === "number" ? { shares: row.retweet_count } : {}),
		},
	};
}

export function withinLookback(
	publishedAtIso: string,
	lookbackDays: number,
	now = Date.now(),
): boolean {
	const ts = Date.parse(publishedAtIso);
	if (!Number.isFinite(ts)) return false;
	return ts >= now - lookbackDays * 86_400_000;
}
