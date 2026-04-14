import type { SourceItem } from "../../source-item.js";

export interface BirdSearchRow {
	id: string;
	text: string;
	createdAt: string; // bird-search emits Twitter's raw format, parseable by new Date()
	replyCount?: number;
	retweetCount?: number;
	likeCount?: number;
	author: { username: string; name: string };
	authorId?: string;
}

export function toSourceItem(row: BirdSearchRow): SourceItem {
	return {
		source: "x",
		id: row.id,
		url: `https://x.com/${row.author.username}/status/${row.id}`,
		title: null,
		text: row.text,
		author: row.author.username,
		publishedAt: new Date(row.createdAt).toISOString(),
		engagement: {
			...(typeof row.likeCount === "number" ? { score: row.likeCount } : {}),
			...(typeof row.replyCount === "number" ? { comments: row.replyCount } : {}),
			...(typeof row.retweetCount === "number" ? { shares: row.retweetCount } : {}),
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
