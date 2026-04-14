// Canonical source identifier. Open-ended string union so consumers can
// register custom adapters; known values are enumerated for type narrowing.
export type KnownSourceName =
	| "reddit"
	| "hn"
	| "x"
	| "linkedin"
	| "github"
	| "polymarket"
	| "bluesky"
	| "scrapecreators";

export type SourceName = KnownSourceName | (string & {});
