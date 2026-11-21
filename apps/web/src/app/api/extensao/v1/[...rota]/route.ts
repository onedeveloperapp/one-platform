import { NextResponse } from "next/server";

import { handleExtensionCall } from "@/lib/filing-ways/extension-api";
import { createServiceClient } from "@flyee/auth/service";

export const dynamic = "force-dynamic";
// The AI's reading of a court's screen may take a while.
export const maxDuration = 60;

/**
 * `/api/extensao/v1/...`: the calls of the lawyer's browser extension (the owner's second way to file, 2026-11-20).
 * Each call carries the token the extension took when the lawyer linked it, which the database checks; linking takes
 * the code ONE showed the lawyer. What each call does is `lib/filing-ways/extension-api.ts`.
 */

const NO_STORE = { "Cache-Control": "no-store" };
/** The largest body a call takes: a court's screen of many frames is far less. */
const MOST_BYTES = 1_000_000;

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MOST_BYTES) return null;
  try {
    const text = await request.text();
    if (text.length > MOST_BYTES) return null;
    const parsed = (text ? JSON.parse(text) : {}) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function answer(request: Request, method: "GET" | "POST", params: Promise<{ rota?: string[] }>) {
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  const path = (await params).rota ?? [];
  const body = method === "POST" ? await bodyOf(request) : null;
  if (method === "POST" && body === null) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await handleExtensionCall(
      { method, path, authorization: request.headers.get("authorization"), body },
      { service },
    );
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
  } catch (error) {
    console.error("extension_call_failed", {
      path: path.slice(0, 1).concat(path.slice(2)),
      message: error instanceof Error ? error.message : "failed",
    });
    return NextResponse.json({ ok: false, error: "failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: Request, context: { params: Promise<{ rota?: string[] }> }) {
  return answer(request, "GET", context.params);
}

export async function POST(request: Request, context: { params: Promise<{ rota?: string[] }> }) {
  return answer(request, "POST", context.params);
}
