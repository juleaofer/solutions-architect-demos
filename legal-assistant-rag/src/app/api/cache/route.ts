import { NextResponse } from "next/server";
import { clearCache } from "@/lib/services/cache";

/**
 * Limpa o cache de perguntas (collection chat_cache). Com o cache vazio, a
 * próxima pergunta volta a percorrer toda a árvore de decisão (roteamento ->
 * execução nativa no MongoDB -> LLM) em vez de reaproveitar uma resposta.
 */
export async function DELETE() {
  try {
    const deleted = await clearCache();
    return NextResponse.json({ ok: true, deleted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
