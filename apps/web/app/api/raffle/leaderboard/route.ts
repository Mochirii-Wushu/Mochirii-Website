import { NextRequest, NextResponse } from "next/server";
import { readRaffleLeaderboard } from "@/lib/raffle/leaderboard";
import {
  readBearerToken,
  spinnerRequestIsSameOrigin,
} from "@/lib/spinner/session-policy";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Security-Policy":
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
  Vary: "Authorization",
} as const;

export async function POST(request: NextRequest) {
  if (
    !spinnerRequestIsSameOrigin({
      requestUrl: request.url,
      origin: request.headers.get("origin"),
      secFetchSite: request.headers.get("sec-fetch-site"),
      requireOrigin: true,
    })
  ) return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS });

  const accessToken = readBearerToken(request.headers.get("authorization"));
  if (!accessToken) {
    return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS });
  }

  const result = await readRaffleLeaderboard(accessToken);
  if (!result.ok) {
    return new NextResponse(null, { status: 404, headers: PRIVATE_HEADERS });
  }
  return NextResponse.json(
    { ok: true, data: result.data },
    { headers: PRIVATE_HEADERS },
  );
}

export function GET() {
  return new NextResponse(null, { status: 405, headers: PRIVATE_HEADERS });
}
