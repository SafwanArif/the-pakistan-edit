import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Institutional Asset Proxy: High-fidelity request forwarding
 * Handles upstream image fetching with specialized user-agents and fail-safe error recovery.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const imageUrl = searchParams.get("url");

    if (!imageUrl) {
        return NextResponse.json({ error: "Missing URL parameter" }, { status: 400 });
    }

    try {
        // Robust fetch with 10s institutional timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(imageUrl, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Sec-CH-UA": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
                "Sec-CH-UA-Mobile": "?0",
                "Sec-CH-UA-Platform": '"Windows"',
                "Sec-Fetch-Dest": "image",
                "Sec-Fetch-Mode": "no-cors",
                "Sec-Fetch-Site": "cross-site",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Referer": "https://www.google.com/"
            }
        });

        clearTimeout(timeout);

        if (!response.ok) throw new Error(`Upstream fault: ${response.status}`);

        const contentType = response.headers.get("content-type");
        if (!contentType?.startsWith("image/")) throw new Error("Invalid asset type");

        return new Response(response.body, {
            headers: {
                "Content-Type": contentType,
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "public, max-age=31536000, immutable",
                "X-Institutional-Proxy": "Active"
            },
        });
    } catch (e) {
        const errorMsg = e instanceof Error ? e.message : "Proxy Failure";
        console.error("ASSET_PROXY_FAULT:", errorMsg);
        return NextResponse.json({ error: errorMsg }, { status: 500 });
    }
}
