import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { TOS_VERSION } from "@/lib/compliance/tos";

/**
 * Record ToS / risk-disclaimer acceptance for a user (red-team C8) by stamping tosAcceptedAt. The
 * execute path refuses to proceed until this is set. Returns the accepted version so the client can
 * detect a future disclaimer bump and re-prompt.
 */
const BodySchema = z.object({ userId: z.string().min(1) });

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    const user = await prisma.user.update({
      where: { id: body.data.userId },
      data: { tosAcceptedAt: new Date() },
      select: { id: true, tosAcceptedAt: true },
    });
    return NextResponse.json({ userId: user.id, tosAcceptedAt: user.tosAcceptedAt, version: TOS_VERSION });
  } catch (e) {
    return NextResponse.json({ error: "could not record acceptance", detail: (e as Error).message }, { status: 503 });
  }
}
