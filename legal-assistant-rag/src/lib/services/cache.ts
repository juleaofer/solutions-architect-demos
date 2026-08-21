import { getDb } from "@/lib/mongodb";
import { RouteResult } from "@/lib/services/intent";

const CACHE_COLLECTION = "chat_cache";
const VECTOR_INDEX = "cache_vec";
// Score do $vectorSearch (0..1). Acima disso consideramos a mesma pergunta.
// O autoEmbed usa voyage-4-lite (embeddings assimétricos query/document), então
// mesmo textos idênticos saturam em ~0.80 — não em 1.0. Fixamos o limiar em 0.80
// (antes 0.75, baixo demais: capturava paráfrases distintas ~0.70 e causava
// colisão). Combinado com a re-síntese no pipeline, só perguntas praticamente
// equivalentes entram no fast-path.
const HIT_THRESHOLD = Number(process.env.CACHE_HIT_THRESHOLD || 0.8);

export interface CachedSource {
  doc_type: string;
  source_id: string;
  numero?: number | null;
}

export interface CacheEntry {
  question: string;
  intent: string;
  countTarget?: string | null;
  signature: string;
  answer: string;
  sources: CachedSource[];
  score?: number;
}

/** Assinatura canônica dos filtros/âncora (ignora intent/apresentação). */
export function computeSignature(route: RouteResult): string {
  const f = route.filters || {};
  const norm = (v?: string) => (v ? v.trim().toLowerCase() : "");
  const parts = [
    f.doc_type || "",
    f.numero ?? "",
    f.ano_sessao ?? "",
    f.ano_processo ?? "",
    norm(f.relator),
    norm(f.decisao),
    norm(f.processo),
    norm(f.interessado),
    norm(f.unidade),
    norm(f.classe),
    route.graph
      ? typeof route.graph.numero === "number"
        ? `graphnum=${route.graph.docType || ""}:${route.graph.numero}`
        : `${route.graph.field}=${norm(route.graph.value)}`
      : "",
  ];
  return parts.join("|");
}

/** Busca semântica no cache por similaridade da pergunta (fast path). */
export async function lookupByVector(
  query: string
): Promise<CacheEntry | null> {
  try {
    const db = await getDb();
    const rows = await db
      .collection(CACHE_COLLECTION)
      .aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: "question_text",
            query: { text: query },
            numCandidates: 50,
            limit: 3,
          },
        },
        {
          $project: {
            _id: 0,
            question: 1,
            intent: 1,
            signature: 1,
            answer: 1,
            sources: 1,
            score: { $meta: "vectorSearchScore" },
          },
        },
      ] as any)
      .toArray();
    const top = rows[0] as CacheEntry | undefined;
    if (top && (top.score ?? 0) >= HIT_THRESHOLD) return top;
    return null;
  } catch (e) {
    console.error("lookupByVector falhou:", e);
    return null;
  }
}

/**
 * Reuso por assinatura de filtros para replay VERBATIM. Casa a MESMA base de
 * filtros (signature) E a MESMA intenção — e, em contagens, o MESMO countTarget.
 * Isso evita colisão entre intenções distintas (ex.: uma contagem e uma pergunta
 * semântica com os mesmos filtros) ou entre alvos de contagem diferentes (quantos
 * acórdãos × quantos processos), que compartilhariam a assinatura de filtros.
 * Só há assinatura quando existe algum filtro/âncora estrutural (senão retorna null).
 */
export async function lookupBySignature(
  signature: string,
  intent: string,
  countTarget?: string | null
): Promise<CacheEntry | null> {
  if (!signature.replace(/\|/g, "")) return null;
  try {
    const db = await getDb();
    const query: Record<string, unknown> = { signature, intent };
    if (intent === "count") query.countTarget = countTarget ?? null;
    const doc = await db
      .collection(CACHE_COLLECTION)
      .findOne(query, {
        projection: { _id: 0, question: 1, intent: 1, countTarget: 1, signature: 1, answer: 1, sources: 1 },
      });
    return (doc as unknown as CacheEntry) || null;
  } catch (e) {
    console.error("lookupBySignature falhou:", e);
    return null;
  }
}

/** Esvazia o cache de perguntas para forçar o fluxo completo da árvore. */
export async function clearCache(): Promise<number> {
  const db = await getDb();
  const res = await db.collection(CACHE_COLLECTION).deleteMany({});
  return res.deletedCount ?? 0;
}

/** Persiste a pergunta respondida no cache (autoEmbed indexa question_text). */
export async function saveToCache(params: {
  question: string;
  route: RouteResult;
  signature: string;
  answer: string;
  sources: CachedSource[];
}): Promise<void> {
  try {
    const db = await getDb();
    await db.collection(CACHE_COLLECTION).insertOne({
      question: params.question,
      question_text: params.question,
      intent: params.route.intent,
      filters: params.route.filters,
      countTarget: params.route.countTarget ?? null,
      graph: params.route.graph ?? null,
      signature: params.signature,
      answer: params.answer,
      sources: params.sources,
      created_at: new Date(),
      hits: 0,
    });
  } catch (e) {
    console.error("saveToCache falhou:", e);
  }
}
