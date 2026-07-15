import { NextResponse } from "next/server";
import { z } from "zod";
import { parseIntent } from "@/agent/parse";
import { CHAIN_ENV } from "@/chain/chains";

/**
 * NL → intent preview. Returns the reconciled intent plus the raw user text so the confirm UI can
 * show the user's original words alongside the parsed trade (red-team C11). Never executes.
 */
const BodySchema = z.object({ text: z.string().min(1).max(500) });

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const outcome = await parseIntent(parsed.data.text, CHAIN_ENV);
  return NextResponse.json({
    rawUserText: parsed.data.text,
    outcome,
    needsConfirm: outcome.status === "ok",
  });
}
