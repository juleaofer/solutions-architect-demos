import { getDb, COLLECTIONS, DocType } from "@/lib/mongodb";
import { LegalDocument } from "@/lib/types";
import { QueryFilters, RouteResult, CountTarget } from "@/lib/services/intent";

const PROJECTION = { embedding: 0, "metadata.texto_decisao_acordao": 0 };
const SEARCH_INDEX = "filters";

function serialize(doc: any): LegalDocument {
  return { ...doc, _id: doc._id?.toString() } as LegalDocument;
}

function rx(value: string) {
  const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { $regex: escaped, $options: "i" };
}

/** Traduz filtros estruturados em um documento $match nativo do MongoDB. */
export function buildMatch(filters: QueryFilters): Record<string, any> {
  const and: Record<string, any>[] = [];
  if (typeof filters.numero === "number") {
    and.push({
      $or: [
        { "metadata.numero": filters.numero },
        { "metadata.numero_resolucao": filters.numero },
      ],
    });
  }
  if (typeof filters.ano_sessao === "number")
    and.push({ "metadata.ano_sessao": filters.ano_sessao });
  if (typeof filters.ano_processo === "number")
    and.push({
      "metadata.processos_relacionados": { $regex: `/${filters.ano_processo}$` },
    });
  if (filters.relator) and.push({ "metadata.relatores": rx(filters.relator) });
  if (filters.interessado)
    and.push({ "metadata.interessados": rx(filters.interessado) });
  if (filters.unidade)
    and.push({ "metadata.unidades_jurisdicionadas": rx(filters.unidade) });
  if (filters.processo)
    and.push({ "metadata.processos_relacionados": rx(filters.processo) });
  if (filters.decisao) and.push({ "metadata.decisoes": rx(filters.decisao) });
  if (filters.classe)
    and.push({ "metadata.classes_subclasses": rx(filters.classe) });

  if (!and.length) return {};
  return and.length === 1 ? and[0] : { $and: and };
}

/**
 * Pré-filtro EXATO para o `filter` do $vectorSearch. O Atlas só aceita
 * operadores exatos aqui ($eq/$ne/$in/$gt.../$and/$or) — nada de regex — então
 * cobrimos apenas os campos indexados como `filter` no índice vetorial dos
 * chunks: numero/numero_resolucao e ano_sessao (doc_type é resolvido pela
 * collection). Os demais campos "fuzzy" (relator, interessado, etc.) continuam
 * via buildMatch como $match pós-fusão. Retorna null quando não há filtro exato.
 */
export function buildVectorFilter(
  filters: QueryFilters
): Record<string, any> | null {
  const and: Record<string, any>[] = [];
  if (typeof filters.numero === "number") {
    and.push({
      $or: [
        { "metadata.numero": filters.numero },
        { "metadata.numero_resolucao": filters.numero },
      ],
    });
  }
  if (typeof filters.ano_sessao === "number")
    and.push({ "metadata.ano_sessao": filters.ano_sessao });
  if (!and.length) return null;
  return and.length === 1 ? and[0] : { $and: and };
}

function phrase(path: string, value: string) {
  return { phrase: { path, query: value.trim() } };
}

/**
 * Monta o operador `compound` do Atlas Search ($search), usado como PRIMEIRO
 * estágio de runFilter/runCount (que batem direto na collection). Ao contrário
 * do buildMatch (regex case-insensitive → collscan; mantido apenas para o $match
 * pós-fusão do rag.ts), aqui os campos "fuzzy" viram `phrase` sobre os campos
 * analisados (lucene.portuguese: casa sem depender de caixa/acento) e os exatos
 * viram `equals` — tudo servido pelo índice `filters`. Retorna null quando não
 * há filtro algum (o caller cai no caminho sem $search).
 */
export function buildSearchCompound(
  filters: QueryFilters
): Record<string, any> | null {
  const filter: Record<string, any>[] = [];
  if (typeof filters.numero === "number") {
    filter.push({
      compound: {
        should: [
          { equals: { path: "metadata.numero", value: filters.numero } },
          { equals: { path: "metadata.numero_resolucao", value: filters.numero } },
        ],
        minimumShouldMatch: 1,
      },
    });
  }
  if (typeof filters.ano_sessao === "number")
    filter.push({ equals: { path: "metadata.ano_sessao", value: filters.ano_sessao } });
  // ano_processo: o ano é um TOKEN do número do processo — prefixo em acordaos
  // ("2000/51784-0") e sufixo em resolucao ("TC/555749/1995"). O analisador
  // padrão quebra em "/" e "-", então casar o ano como phrase no campo analisado
  // encontra os DOIS formatos, servido pelo índice (sem regex/collscan). Corrige
  // o antigo { $regex: "/ano$" }, que só pegava o sufixo (ok em resolucao, mas
  // falhava em acordaos, a collection maior).
  if (typeof filters.ano_processo === "number")
    filter.push(phrase("metadata.processos_relacionados", String(filters.ano_processo)));
  if (filters.relator) filter.push(phrase("metadata.relatores", filters.relator));
  if (filters.interessado)
    filter.push(phrase("metadata.interessados", filters.interessado));
  if (filters.unidade)
    filter.push(phrase("metadata.unidades_jurisdicionadas", filters.unidade));
  if (filters.processo)
    filter.push(phrase("metadata.processos_relacionados", filters.processo));
  if (filters.decisao) filter.push(phrase("metadata.decisoes", filters.decisao));
  if (filters.classe)
    filter.push(phrase("metadata.classes_subclasses", filters.classe));
  if (!filter.length) return null;
  return { filter };
}

function collectionsFor(filters: QueryFilters): DocType[] {
  return filters.doc_type
    ? [filters.doc_type]
    : (["acordao", "resolucao"] as DocType[]);
}

/** Executa a busca filtrada (intent=filter): só retorna docs que satisfazem os filtros. */
export async function runFilter(
  route: RouteResult,
  limit = 12
): Promise<LegalDocument[]> {
  const db = await getDb();
  const compound = buildSearchCompound(route.filters);
  const out: LegalDocument[] = [];
  for (const type of collectionsFor(route.filters)) {
    const col = db.collection(COLLECTIONS[type]);
    // Com filtros: $search (índice `filters`) resolve tudo pelo índice Lucene.
    // Sem filtros: find({}) simples devolve os primeiros `limit` documentos.
    const docs = compound
      ? await col
          .aggregate([
            { $search: { index: SEARCH_INDEX, compound } },
            { $limit: limit },
            { $project: PROJECTION },
          ])
          .toArray()
      : await col.find({}, { projection: PROJECTION }).limit(limit).toArray();
    out.push(...docs.map(serialize));
  }
  return out.slice(0, limit);
}

const TARGET_FIELD: Record<Exclude<CountTarget, "documentos">, string> = {
  processos: "metadata.processos_relacionados",
  relatores: "metadata.relatores",
  interessados: "metadata.interessados",
  unidades: "metadata.unidades_jurisdicionadas",
};

export interface CountResult {
  target: CountTarget;
  total: number;
  byCollection: Record<string, number>;
  amostra?: string[];
}

/** Quantitativo nativo via aggregation ($search + $count / $unwind + $group). */
export async function runCount(route: RouteResult): Promise<CountResult> {
  const db = await getDb();
  const compound = buildSearchCompound(route.filters);
  const target = route.countTarget || "documentos";
  const byCollection: Record<string, number> = {};

  if (target === "documentos") {
    let total = 0;
    for (const type of collectionsFor(route.filters)) {
      const col = db.collection(COLLECTIONS[type]);
      // Com filtros: conta pelos METADADOS do índice via $searchMeta (count
      // total) — o Lucene devolve o total SEM materializar/transmitir os
      // documentos que casam (ao contrário do $search + $count, que streamava
      // todos só para contá-los). Sem filtros: estimatedDocumentCount() lê o
      // total da collection dos metadados em O(1), evitando a varredura que
      // countDocuments({}) provoca com predicado vazio.
      let n: number;
      if (compound) {
        const r = await col
          .aggregate([
            { $searchMeta: { index: SEARCH_INDEX, count: { type: "total" }, compound } },
          ])
          .toArray();
        n = Number((r[0] as any)?.count?.total ?? 0);
      } else {
        n = await col.estimatedDocumentCount();
      }
      byCollection[type] = n;
      total += n;
    }
    return { target, total, byCollection };
  }

  // valores distintos: acumula num único Set para deduplicar entre collections
  const field = TARGET_FIELD[target];
  const distinct = new Set<string>();
  for (const type of collectionsFor(route.filters)) {
    const res = await db
      .collection(COLLECTIONS[type])
      .aggregate([
        ...(compound ? [{ $search: { index: SEARCH_INDEX, compound } }] : []),
        { $unwind: `$${field}` },
        { $group: { _id: `$${field}` } },
      ])
      .toArray();
    byCollection[type] = res.length;
    res.forEach((d: any) => distinct.add(String(d._id)));
  }
  return {
    target,
    total: distinct.size,
    byCollection,
    amostra: Array.from(distinct).slice(0, 15),
  };
}
