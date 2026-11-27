import { NextResponse } from "next/server";
import dns from "dns/promises";
import net from "net";
import { createByteLimitTransform } from "@/lib/server/videoMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_URL_LENGTH = 4096;
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "::", "0.0.0.0", "metadata.google.internal"]);
const VALID_IMAGE_MIME_RE = /^image\/[a-z0-9.+-]+$/i;

const normalizeHost = (raw: string): string =>
    raw.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]?.replace(/\.+$/, "") ?? "";

const isPrivateIpv4Octets = (a: number, b: number, c: number): boolean =>
    a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);

const expandIpv6 = (ip: string): number[] | null => {
    const [headRaw, tailRaw, extra] = ip.split("::");
    if (extra !== undefined) return null;
    const parsePart = (part: string): number[] | null => {
        if (!part) return [];
        const groups: number[] = [];
        for (const seg of part.split(":")) {
            if (seg.includes(".")) {
                if (!net.isIPv4(seg)) return null;
                const [a, b, c, d] = seg.split(".").map(Number) as [number, number, number, number];
                groups.push((a << 8) | b, (c << 8) | d);
            } else if (/^[0-9a-f]{1,4}$/i.test(seg)) {
                groups.push(parseInt(seg, 16));
            } else {
                return null;
            }
        }
        return groups;
    };
    const head = parsePart(headRaw ?? "");
    const tail = tailRaw !== undefined ? parsePart(tailRaw) : [];
    if (!head || !tail) return null;
    if (tailRaw === undefined) return head.length === 8 ? head : null;
    const missing = 8 - head.length - tail.length;
    return missing >= 1 ? [...head, ...new Array<number>(missing).fill(0), ...tail] : null;
};

const isPrivateIpv6 = (ip: string): boolean => {
    const g = expandIpv6(ip);
    if (!g) return true;
    const [g0, g1, g2, g3, g4, g5] = g as [number, number, number, number, number, number, number, number];
    const zero4 = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0;
    return (zero4 && g4 === 0 && g5 === 0) // ::/96 (::, ::1, IPv4-compatible)
        || (zero4 && ((g4 === 0 && g5 === 0xffff) || (g4 === 0xffff && g5 === 0))) // IPv4-mapped/translated
        || (g0 === 0x0064 && g1 === 0xff9b && ((g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) || g2 === 1)) // NAT64
        || (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) // 100::/64 discard
        || (g0 === 0x2001 && (g1 === 0 || g1 === 0x0db8)) // Teredo & documentation
        || g0 === 0x2002 // 6to4 IPv4 tunnel
        || (g0 & 0xfe00) === 0xfc00 // fc00::/7 unique local
        || (g0 & 0xffc0) === 0xfe80 // fe80::/10 link-local
        || (g0 & 0xff00) === 0xff00; // ff00::/8 multicast
};

const isPrivateOrReservedHost = (rawHost: string): boolean => {
    const host = normalizeHost(rawHost);
    if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) return true;
    if (net.isIPv4(host)) {
        const [a, b, c] = host.split(".").map(Number) as [number, number, number, number];
        return isPrivateIpv4Octets(a, b, c);
    }
    return net.isIPv6(host) || host.includes(":") ? isPrivateIpv6(host) : false;
};

/** Proxies external image assets with CORS headers for in-browser canvas export. */
export async function GET(request: Request) {
    const imageUrl = new URL(request.url).searchParams.get("url");
    if (!imageUrl || imageUrl.length > MAX_URL_LENGTH) {
        return NextResponse.json({ error: "Missing or invalid URL parameter" }, { status: 400 });
    }

    let parsedUrl: URL;
    try { parsedUrl = new URL(imageUrl); } catch { return NextResponse.json({ error: "Invalid URL" }, { status: 400 }); }

    const cleanHost = normalizeHost(parsedUrl.hostname);
    if (
        (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")
        || parsedUrl.username || parsedUrl.password
        || !ALLOWED_PORTS.has(parsedUrl.port)
        || isPrivateOrReservedHost(cleanHost)
    ) {
        return NextResponse.json({ error: "Unsupported URL target" }, { status: 400 });
    }

    if (net.isIP(cleanHost) === 0) {
        try {
            const resolved = await dns.lookup(cleanHost, { all: true });
            if (resolved.length === 0 || resolved.some((entry) => isPrivateOrReservedHost(entry.address))) {
                return NextResponse.json({ error: "Unsupported URL target" }, { status: 400 });
            }
        } catch {
            return NextResponse.json({ error: "Failed to resolve target host" }, { status: 400 });
        }
    }

    try {
        const signal = typeof AbortSignal.any === "function"
            ? AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
            : AbortSignal.timeout(10_000);
        const response = await fetch(parsedUrl.toString(), {
            signal,
            redirect: "error",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Dest": "image",
                "Sec-Fetch-Mode": "no-cors",
                "Sec-Fetch-Site": "cross-site",
                "Referer": "https://www.google.com/",
            },
        });

        const cancelBody = () => response.body?.cancel().catch(() => {});
        if (!response.ok) { await cancelBody(); return NextResponse.json({ error: `Upstream fault: ${response.status}` }, { status: 502 }); }

        const mime = (response.headers.get("content-type") || "").split(";")[0]?.trim().toLowerCase() ?? "";
        if (!VALID_IMAGE_MIME_RE.test(mime) || mime.includes("svg")) {
            await cancelBody();
            return NextResponse.json({ error: "Invalid asset type" }, { status: 415 });
        }

        const contentLength = Number(response.headers.get("content-length") || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
            await cancelBody();
            return NextResponse.json({ error: "Image exceeds 25MB limit" }, { status: 413 });
        }

        const safeBody = response.body ? response.body.pipeThrough(createByteLimitTransform(MAX_IMAGE_BYTES)) : null;
        return new Response(safeBody, {
            headers: {
                "Content-Type": mime,
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        });
    } catch (e) {
        if (e instanceof Error && e.name === "TimeoutError") return NextResponse.json({ error: "Upstream image request timed out" }, { status: 504 });
        if (request.signal.aborted || (e instanceof Error && e.name === "AbortError")) return new Response(null, { status: 499 });
        const errorMsg = e instanceof Error ? e.message : "Proxy Failure";
        console.error("ASSET_PROXY_FAULT:", errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 502 });
    }
}
