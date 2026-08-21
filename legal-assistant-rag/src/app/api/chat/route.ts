import { NextRequest, NextResponse } from "next/server";
import { answerQuestion } from "@/lib/services/pipeline";
import { LLMMessage } from "@/lib/services/llm";
import { ChatMessage } from "@/lib/types";

/**
 * Chat com árvore de decisão + cache semântico:
 * cache (vector) -> roteamento de intenção -> execução nativa no MongoDB
 * (filter / count via aggregation / graph via $graphLookup / semântico) -> LLM.
 */
export async function POST(req: NextRequest) {
  try {
    const { messages, userId, sessionId } = (await req.json()) as {
      messages: ChatMessage[];
      userId?: string;
      sessionId?: string;
    };
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      return NextResponse.json({ error: "sem mensagem do usuário" }, { status: 400 });
    }

    const history: LLMMessage[] = messages
      .slice(-6, -1)
      .map((m) => ({ role: m.role, content: m.content })) as LLMMessage[];

    const { answer, sources, mode, cached } = await answerQuestion(
      lastUser.content,
      history,
      { userId, sessionId }
    );

    // Formato compatível com os chips de fonte do ChatView.
    const uiSources = sources.map((s) => ({
      _id: s.source_id,
      doc_type: s.doc_type,
      source_id: s.source_id,
      metadata: { numero: s.numero ?? undefined },
    }));

    return NextResponse.json({ answer, sources: uiSources, mode, cached });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
