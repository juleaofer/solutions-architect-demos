import { NextRequest, NextResponse } from "next/server";
import { getFacts, clearMemory } from "@/lib/services/memory";

/**
 * Memória do agente (collection agent_memory), separada do cache de perguntas.
 * GET  ?userId=...            -> fatos de longo prazo lembrados do usuário.
 * DELETE ?userId=...&scope=session&sessionId=...  -> limpa a memória de curto prazo.
 * DELETE ?userId=...&scope=all -> limpa curto + longo prazo do usuário.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });
    }
    const facts = await getFacts(userId);
    return NextResponse.json({ facts });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const userId = sp.get("userId");
    const scope = (sp.get("scope") as "session" | "all") || "session";
    const sessionId = sp.get("sessionId") ?? undefined;
    if (!userId) {
      return NextResponse.json({ error: "userId obrigatório" }, { status: 400 });
    }
    const deleted = await clearMemory(userId, scope, sessionId);
    return NextResponse.json({ ok: true, deleted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
