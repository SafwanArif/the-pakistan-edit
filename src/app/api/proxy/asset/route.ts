import { NextResponse } from "next/server";
import dns from "dns/promises";
import { createByteLimitTransform } from "@/lib/server/videoMedia";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "::", "0.0.0.0", "metadata.google.internal"]);

const isPrivateOrReservedHost = (rawHost: string): boolean => {
    const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    if (!host || BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) return true;

    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (ipv4) {
        const [, a, b] = ipv4.map(Number);
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 169 && b === 254) return true;
        if (a === 172 && b! >= 16 && b! <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 100 && b! >= 64 && b! <= 127) return true;
    }

    if (host.includes(":")) {
        if (
            host === "::1" ||
            host === "::" ||
            /^fe[89ab][0-9a-f]:/.test(host) ||
            host.startsWith("fc") ||
            host.startsWith("fd") ||
            host.startsWith("::ffff:")
        ) {
            return true;
        }
    }
    return false;
};

/**
 * Proxies external image assets with CORS headers for in-browser canvas export.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get("url");

    if (!imageUrl) {
        return NextResponse.json({ error: "Missing URL parameter" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(imageUrl);
    } catch {
        return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    const cleanHost = parsedUrl.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    if (
        (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
        isPrivateOrReservedHost(cleanHost)
    ) {
        return NextResponse.json({ error: "Unsupported URL target" }, { status: 400 });
    }

    try {
        const resolved = await dns.lookup(cleanHost, { all: true });
        if (resolved.length === 0 || resolved.some((entry) => isPrivateOrReservedHost(entry.address))) {
            return NextResponse.json({ error: "Unsupported URL target" }, { status: 400 });
        }
    } catch {
        return NextResponse.json({ error: "Failed to resolve target host" }, { status: 400 });
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
                "Referer": "https://www.google.com/"
            }
        });

        const cancelBody = async () => {
            await response.body?.cancel().catch(() => { /* stream already cancelled */ });
        };

        if (!response.ok) {
            await cancelBody();
            throw new Error(`Upstream fault: ${response.status}`);
        }

        const rawContentType = response.headers.get("content-type") || "";
        const contentType = rawContentType.toLowerCase().trim();
        if (!contentType.startsWith("image/") || contentType.startsWith("image/svg+xml")) {
            await cancelBody();
            throw new Error("Invalid asset type");
        }

        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > MAX_IMAGE_BYTES) {
            await cancelBody();
            throw new Error("Image exceeds 25MB limit");
        }

        const safeBody = response.body ? response.body.pipeThrough(createByteLimitTransform(MAX_IMAGE_BYTES)) : null;

        return new Response(safeBody, {
            headers: {
                "Content-Type": rawContentType,
                "Content-Security-Policy": "default-src 'none'; sandbox",
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        });
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Proxy Failure";
        console.error("ASSET_PROXY_FAULT:", errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 500 });
    }
}
