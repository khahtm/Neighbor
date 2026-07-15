import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Link an authenticated Privy user to their non-custodial wallet address.
 * We persist ONLY the public address + chainEnv — never a private key (non-custodial).
 *
 * NOTE: this is a minimal Phase 2 stub. Before production it MUST verify the Privy auth token
 * server-side (@privy-io/server-auth) instead of trusting a client-supplied authId.
 */
const BodySchema = z.object({
  authId: z.string().min(1),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainEnv: z.enum(["testnet", "mainnet"]),
});

export async function POST(req: Request) {
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { authId, address, chainEnv } = parsed.data;

  try {
    const user = await prisma.user.upsert({
      where: { authId },
      create: { authId },
      update: {},
    });
    await prisma.wallet.upsert({
      where: { address_chainEnv: { address, chainEnv } },
      create: { userId: user.id, address, chainEnv },
      update: {},
    });
    return NextResponse.json({ userId: user.id });
  } catch (e) {
    // Most likely DATABASE_URL not configured yet — surface clearly instead of 500.
    return NextResponse.json(
      { error: "database unavailable", detail: (e as Error).message },
      { status: 503 },
    );
  }
}
