import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0", "metadata.google.internal"]);

const isPrivateOrReservedHost = (rawHost: string): boolean => {
    const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
    if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) return true;

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
        if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("::ffff:")) {
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

    if (
        (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
        isPrivateOrReservedHost(parsedUrl.hostname)
    ) {
        return NextResponse.json({ error: "Unsupported URL target" }, { status: 400 });
    }

    try {
        const response = await fetch(parsedUrl.toString(), {
            signal: AbortSignal.timeout(10_000),
            redirect: "error",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-Fetch-Dest": "image",
                "Sec-Fetch-Mode": "no-cors",
                "Sec-Fetch-Site": "cross-site",
                "Referer": "https://www.google.com/"
            }
        });

        if (!response.ok) throw new Error(`Upstream fault: ${response.status}`);

        const contentType = response.headers.get("content-type");
        if (!contentType?.startsWith("image/")) throw new Error("Invalid asset type");

        const contentLength = Number(response.headers.get("content-length") || 0);
        if (contentLength > MAX_IMAGE_BYTES) throw new Error("Image exceeds 25MB limit");

        return new Response(response.body, {
            headers: {
                "Content-Type": contentType,
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
