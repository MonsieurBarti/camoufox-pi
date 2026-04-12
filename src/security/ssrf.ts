import type { LookupAddress } from "node:dns";
import { promises as dns } from "node:dns";

// Private / loopback / link-local ranges for IPv4.
const IPV4_PRIVATE = [
	{ prefix: [127], mask: 0xff000000 }, // 127.0.0.0/8 loopback
	{ prefix: [10], mask: 0xff000000 }, // 10.0.0.0/8
	{ prefix: [172, 16], mask: 0xfff00000 }, // 172.16.0.0/12
	{ prefix: [192, 168], mask: 0xffff0000 }, // 192.168.0.0/16
	{ prefix: [169, 254], mask: 0xffff0000 }, // 169.254.0.0/16 link-local + AWS/GCP metadata
	{ prefix: [0], mask: 0xff000000 }, // 0.0.0.0/8
	{ prefix: [100, 64], mask: 0xffc00000 }, // 100.64.0.0/10 CGNAT
];

function ipv4ToUint(parts: number[]): number {
	return (
		((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)
	);
}

function isPrivateIPv4(ip: string): boolean {
	const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
	if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
		return true; // malformed = fail safe
	}
	const ipInt = ipv4ToUint(parts) >>> 0;
	for (const { prefix, mask } of IPV4_PRIVATE) {
		const prefixInt = ipv4ToUint([...prefix, 0, 0, 0, 0].slice(0, 4)) >>> 0;
		if ((ipInt & mask) === (prefixInt & mask)) return true;
	}
	return false;
}

function isPrivateIPv6(ip: string): boolean {
	// ::1 loopback
	if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
	const lower = ip.toLowerCase();
	// fc00::/7 unique-local
	if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
	// fe80::/10 link-local
	if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
	// ::ffff:IPv4 mapped — check the IPv4 portion
	const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
	return false;
}

export type LookupFn = typeof dns.lookup;

export async function assertSafeTarget(
	url: string,
	opts: { lookup?: LookupFn } = {},
): Promise<void> {
	const parsed = new URL(url);
	const hostname = parsed.hostname;
	// Literal IPv4 in the URL — check directly.
	if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
		if (isPrivateIPv4(hostname)) {
			throw new Error(`SSRF: target ${hostname} is a private IPv4`);
		}
		return;
	}
	// IPv6 literal — hostname will have brackets stripped by URL parser.
	if (hostname.includes(":")) {
		if (isPrivateIPv6(hostname.replace(/^\[|\]$/g, ""))) {
			throw new Error(`SSRF: target ${hostname} is a private IPv6`);
		}
		return;
	}
	// DNS resolve and check every address.
	const lookup = opts.lookup ?? dns.lookup;
	let addrs: LookupAddress[];
	try {
		// Using overload: lookup(hostname, { all: true, verbatim: true })
		const result = (await lookup(hostname, { all: true, verbatim: true })) as LookupAddress[];
		addrs = result;
	} catch (err) {
		throw new Error(
			`SSRF: cannot resolve ${hostname}: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	for (const { address, family } of addrs) {
		if (family === 4 && isPrivateIPv4(address)) {
			throw new Error(`SSRF: ${hostname} resolves to private IPv4 ${address}`);
		}
		if (family === 6 && isPrivateIPv6(address)) {
			throw new Error(`SSRF: ${hostname} resolves to private IPv6 ${address}`);
		}
	}
}
