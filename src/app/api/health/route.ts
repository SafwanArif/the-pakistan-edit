import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json({
        status: "ok",
        capabilities: {
            localIngest: process.env.VERCEL !== "1",
        },
        env: {
            nodeEnv: process.env.NODE_ENV
        },
        timestamp: new Date().toISOString()
    });
}
