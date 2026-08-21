import { getDb } from "@/lib/mongodb";
import { chatCompletion } from "@/lib/services/llm";

/**
 * Memória do agente (collection `agent_memory`, separada do cache de perguntas).
 * Dois tipos de documento:
 *  - kind: "turn"  -> memória de CURTO prazo (por sessionId): últimos diálogos.
 *  - kind: "fact"  -> memória de LONGO prazo (por userId): fatos duráveis sobre
 *    o usuário (nome, papel, interesses, preferências) que persistem entre sessões.
 */
const MEMORY_COLLECTION = process.env.MEMORY_COLLECTION || "agent_memory";
const MAX_TURNS = 8; // janela de curto prazo injetada no prompt
const MAX_FACTS = 40; // teto de fatos de longo prazo por usuário

export interface MemoryTurn {
  question: string;
  answer: string;
}

export interface LoadedMemory {
  facts: string[];
  turns: MemoryTurn[];
}

/** Carrega fatos de longo prazo (por usuário) + últimos turnos da sessão atual. */
export async function loadMemory(
  userId: string,
  sessionId: string
): Promise<LoadedMemory> {
  try {
    const db = await getDb();
    const col = db.collection(MEMORY_COLLECTION);
    const [factDocs, turnDocs] = await Promise.all([
      col.find({ kind: "fact", userId }).sort({ created_at: 1 }).limit(MAX_FACTS).toArray(),
      col
        .find({ kind: "turn", userId, sessionId })
        .sort({ created_at: -1 })
        .limit(MAX_TURNS)
        .toArray(),
    ]);
    return {
      facts: factDocs.map((d: any) => d.text as string),
      turns: turnDocs
        .reverse()
        .map((d: any) => ({ question: d.question, answer: d.answer })),
    };
  } catch (e) {
    console.error("loadMemory falhou:", e);
    return { facts: [], turns: [] };
  }
}

/** Monta o bloco textual de memória para injetar no prompt da LLM. */
export function buildMemoryBlock(mem: LoadedMemory): string {
  const factsTxt = mem.facts.length
    ? `Fatos de longo prazo sobre o usuário (lembrados de conversas anteriores):\n${mem.facts
        .map((f) => `- ${f}`)
        .join("\n")}`
    : "";
  const turnsTxt = mem.turns.length
    ? `Histórico recente desta conversa (memória de curto prazo):\n${mem.turns
        .map((t) => `Usuário: ${t.question}\nAssistente: ${t.answer}`)
        .join("\n")}`
    : "";
  return [factsTxt, turnsTxt].filter(Boolean).join("\n\n");
}

/** Persiste um turno (pergunta + resposta) como memória de curto prazo. */
export async function saveTurn(
  userId: string,
  sessionId: string,
  question: string,
  answer: string
): Promise<void> {
  try {
    const db = await getDb();
    await db.collection(MEMORY_COLLECTION).insertOne({
      kind: "turn",
      userId,
      sessionId,
      question,
      answer,
      created_at: new Date(),
    });
  } catch (e) {
    console.error("saveTurn falhou:", e);
  }
}

const EXTRACT_SYSTEM = `Você extrai fatos DURÁVEIS sobre o usuário a partir da mensagem dele para uma memória de longo prazo.
Responda APENAS um objeto JSON: {"facts": string[]}.
Inclua somente informações pessoais e estáveis declaradas PELO usuário: nome, cargo/papel, área de interesse, preferências de resposta, objetivos em andamento.
NÃO inclua: perguntas factuais sobre acórdãos/resoluções, números de documentos, dados jurídicos, nem conteúdo efêmero.
Cada fato deve ser uma frase curta, em português, na 3ª pessoa (ex.: "O usuário se chama João", "O usuário se interessa por licitações").
Se não houver nada durável, responda {"facts": []}.`;

/** Extrai fatos duráveis da mensagem do usuário e grava os novos (deduplicados). */
export async function extractAndSaveFacts(
  userId: string,
  question: string,
  existingFacts: string[]
): Promise<string[]> {
  try {
    const out = await chatCompletion(
      [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: question },
      ],
      { temperature: 0, jsonMode: true }
    );
    const parsed = JSON.parse(out);
    const candidates: string[] = Array.isArray(parsed?.facts) ? parsed.facts : [];
    const existing = new Set(existingFacts.map((f) => f.trim().toLowerCase()));
    const fresh = candidates
      .map((f) => String(f).trim())
      .filter((f) => f && !existing.has(f.toLowerCase()));
    if (!fresh.length) return [];
    const db = await getDb();
    await db.collection(MEMORY_COLLECTION).insertMany(
      fresh.map((text) => ({ kind: "fact", userId, text, created_at: new Date() }))
    );
    return fresh;
  } catch (e) {
    console.error("extractAndSaveFacts falhou:", e);
    return [];
  }
}

/** Lista os fatos de longo prazo de um usuário (para a UI de memória). */
export async function getFacts(userId: string): Promise<string[]> {
  const db = await getDb();
  const docs = await db
    .collection(MEMORY_COLLECTION)
    .find({ kind: "fact", userId })
    .sort({ created_at: 1 })
    .limit(MAX_FACTS)
    .toArray();
  return docs.map((d: any) => d.text as string);
}

/** Limpa a memória: escopo "session" (curto prazo) ou "all" (curto + longo). */
export async function clearMemory(
  userId: string,
  scope: "session" | "all",
  sessionId?: string
): Promise<number> {
  const db = await getDb();
  const col = db.collection(MEMORY_COLLECTION);
  if (scope === "session") {
    const res = await col.deleteMany({ kind: "turn", userId, sessionId });
    return res.deletedCount ?? 0;
  }
  const res = await col.deleteMany({ userId });
  return res.deletedCount ?? 0;
}
