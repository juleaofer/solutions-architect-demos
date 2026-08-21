import {
  getDb,
  COLLECTIONS,
  CHUNK_COLLECTIONS,
  USE_CHUNKS,
  DocType,
} from "@/lib/mongodb";
import { LegalDocument } from "@/lib/types";
import { QueryFilters } from "@/lib/services/intent";
import { buildMatch, buildVectorFilter } from "@/lib/services/filters";

/** Máximo de trechos (chunks) reconstruídos por documento-pai no contexto. */
const MAX_CHUNKS_PER_PARENT = 4;

function serialize(doc: any): LegalDocument {
  const { content, embedding, ...rest } = doc;
  return { ...rest, _id: doc._id?.toString(), content } as LegalDocument;
}

// Captura o número citado logo após "acórdão"/"resolução" (com nº/n°/número opcional).
const NUM_RE =
  /(?:ac[oó]rd[aã]o|resolu[cç][aã]o)\s*(?:n[º°o.]{0,2}|n[uú]mero)?\s*[:.]?\s*(\d[\d.\s]*)/gi;

/** Extrai números de acórdão/resolução citados na pergunta (ex.: "nº 35.166" -> 35166). */
export function extractNumeros(query: string): number[] {
  const nums = new Set<number>();
  let m: RegExpExecArray | null;
  NUM_RE.lastIndex = 0;
  while ((m = NUM_RE.exec(query)) !== null) {
    const digits = m[1].replace(/[^0-9]/g, "");
    if (digits) {
      const n = parseInt(digits, 10);
      if (!Number.isNaN(n)) nums.add(n);
    }
    if (nums.size >= 5) break;
  }
  return Array.from(nums);
}

/** Monta o estágio de busca textual (Atlas Search) com boost exato por número. */
function buildSearchStage(query: string, numeros: number[]): any {
  if (numeros.length) {
    const should: any[] = [
      { text: { query, path: ["content", "metadata.ementa"] } },
    ];
    for (const n of numeros) {
      should.push({
        equals: {
          path: "metadata.numero",
          value: n,
          score: { boost: { value: 10 } },
        },
      });
      should.push({
        equals: {
          path: "metadata.numero_resolucao",
          value: n,
          score: { boost: { value: 10 } },
        },
      });
    }
    return { index: "fulltext", compound: { should, minimumShouldMatch: 1 } };
  }
  return { index: "fulltext", text: { query, path: ["content", "metadata.ementa"] } };
}

/** Executa $rankFusion (vetorial + textual) sobre uma collection e projeta os campos. */
async function fusionRows(
  col: any,
  searchStage: any,
  query: string,
  poolSize: number,
  finalLimit: number,
  extraProject: Record<string, 1>,
  vectorFilter: Record<string, any> | null = null,
  postMatch: Record<string, any> = {}
): Promise<any[]> {
  // Pré-filtro EXATO dentro da busca vetorial (numero/ano_sessao): restringe os
  // candidatos vetoriais ANTES do ranqueamento semântico.
  const vs: Record<string, any> = {
    index: "default",
    path: "content",
    query: { text: query },
    numCandidates: Math.max(100, poolSize * 5),
    limit: poolSize,
  };
  if (vectorFilter) vs.filter = vectorFilter;

  return col
    .aggregate([
      {
        $rankFusion: {
          input: {
            pipelines: {
              vectorPipeline: [{ $vectorSearch: vs }],
              textPipeline: [{ $search: searchStage }, { $limit: poolSize }],
            },
          },
          combination: { weights: { vectorPipeline: 1, textPipeline: 1 } },
        },
      },
      // Garante que TODOS os filtros (inclusive os "fuzzy" via regex, que o
      // $vectorSearch.filter não suporta) valham para a lista fundida, antes do
      // corte final — preserva a ordem do RRF removendo o que não casa.
      ...(Object.keys(postMatch).length ? [{ $match: postMatch }] : []),
      { $limit: finalLimit },
      {
        $project: {
          content: 1,
          source: 1,
          source_id: 1,
          num_pages: 1,
          doc_type: 1,
          metadata: 1,
          ...extraProject,
          score: { $meta: "score" },
        },
      },
    ] as any)
    .toArray();
}

/**
 * Agrupa chunks recuperados de volta em documentos-pai (por `source_id`),
 * preservando a ordem do RRF. Mantém até MAX_CHUNKS_PER_PARENT trechos por
 * documento e reconstrói o `content` a partir dos chunks que casaram (com
 * marcador "[...]" quando há salto de posição), até `limit` documentos.
 */
function groupChunksToParents(rows: any[], limit: number): LegalDocument[] {
  const order: string[] = [];
  const map = new Map<
    string,
    { base: any; chunks: Map<number, string>; score: number }
  >();
  for (const r of rows) {
    const key = r.source_id;
    if (key == null) continue;
    let e = map.get(key);
    if (!e) {
      if (order.length >= limit) continue;
      e = { base: r, chunks: new Map(), score: r.score ?? 0 };
      map.set(key, e);
      order.push(key);
    }
    if (e.chunks.size < MAX_CHUNKS_PER_PARENT && !e.chunks.has(r.chunk_index)) {
      e.chunks.set(r.chunk_index, r.content || "");
    }
  }
  return order.map((key) => {
    const e = map.get(key)!;
    const b = e.base;
    const idxs = Array.from(e.chunks.keys()).sort((x, y) => x - y);
    let merged = "";
    let prev: number | null = null;
    for (const idx of idxs) {
      if (prev !== null) merged += idx === prev + 1 ? "\n\n" : "\n[...]\n";
      merged += e.chunks.get(idx) || "";
      prev = idx;
    }
    return {
      _id: String(b.parent_oid ?? key),
      source: b.source,
      source_id: b.source_id,
      num_pages: b.num_pages,
      doc_type: b.doc_type,
      metadata: b.metadata,
      content: merged,
      score: e.score,
    } as LegalDocument;
  });
}

/**
 * Recupera documentos relevantes combinando busca textual (Atlas Search) e
 * vector search, fundidos por `$rankFusion` nativo (Reciprocal Rank Fusion).
 * v3: busca primeiro nas collections de CHUNKS (um vetor por trecho → match
 * mais afiado) e reagrupa por documento-pai; cai automaticamente para a busca
 * por documento inteiro (v2) se os chunks estiverem desligados/vazios/índice
 * ainda não pronto. Quando a pergunta cita um número, aplica match EXATO no
 * campo numérico (operador `equals`) com boost, garantindo o documento correto.
 */
export async function retrieveContext(
  query: string,
  limit = 6,
  filters?: QueryFilters
): Promise<LegalDocument[]> {
  const db = await getDb();
  const numeros = extractNumeros(query);
  const numSet = new Set(numeros);
  const searchStage = buildSearchStage(query, numeros);
  const types = ["acordao", "resolucao"] as DocType[];

  // Filtros do roteador viram constraints da busca vetorial: pré-filtro EXATO
  // dentro do $vectorSearch (numero/ano_sessao) + $match pós-fusão para os
  // campos "fuzzy" (relator, interessado, unidade, processo, decisao, classe,
  // ano_processo). O boost lexical por número (buildSearchStage) segue ativo
  // para perguntas ambíguas/multi-documento.
  const vectorFilter = filters ? buildVectorFilter(filters) : null;
  const postMatch = filters ? buildMatch(filters) : {};
  // doc_type: quando o roteador fixa o tipo, restringe as collections buscadas.
  const searchTypes =
    filters?.doc_type ? ([filters.doc_type] as DocType[]) : types;

  // Lista já fundida (texto + vetorial) via $rankFusion, por collection.
  const perType: Record<string, LegalDocument[]> = {};
  // Pool fundo o suficiente para cobrir vários chunks por documento-pai.
  const chunkPool = Math.max(limit * 10, 60);
  const poolSize = limit * 2;

  // v3: tenta recuperar por CHUNKS (um vetor por trecho → match mais afiado);
  // fallback POR TIPO para doc-level (v2) se os chunks estiverem
  // desligados/vazios ou o índice de chunks ainda não estiver pronto.
  //
  // As collections são INDEPENDENTES (cada tipo só produz sua própria lista),
  // então rodam EM PARALELO via Promise.all: a latência desta etapa passa de
  // soma(acordao, resolucao) para max(...) — ~metade no caso típico, no caminho
  // semântico (a rota mais comum). Cada tipo mantém seu try/catch e o fallback
  // doc-level, de forma que a falha de uma collection não derruba a outra nem
  // rejeita o Promise.all.
  const searchOneType = async (type: DocType): Promise<LegalDocument[]> => {
    let docs: LegalDocument[] = [];
    if (USE_CHUNKS) {
      try {
        const rows = await fusionRows(
          db.collection(CHUNK_COLLECTIONS[type]),
          searchStage,
          query,
          chunkPool,
          chunkPool,
          { chunk_index: 1, parent_oid: 1 },
          vectorFilter,
          postMatch
        );
        docs = groupChunksToParents(rows, limit);
      } catch (e) {
        console.error(`chunk $rankFusion falhou (${type}):`, e);
        docs = [];
      }
    }
    if (docs.length === 0) {
      try {
        // Fallback doc-level (v2): sem pré-filtro vetorial (o índice antigo pode
        // não expor esses campos como filter), mas o $match pós-fusão continua
        // aplicando TODOS os filtros para manter a constraint.
        const rows = await fusionRows(
          db.collection(COLLECTIONS[type]),
          searchStage,
          query,
          poolSize,
          limit,
          {},
          null,
          postMatch
        );
        docs = rows.map(serialize);
      } catch (e) {
        console.error(`$rankFusion falhou (${type}):`, e);
        docs = [];
      }
    }
    return docs;
  };

  const perTypeDocs = await Promise.all(searchTypes.map(searchOneType));
  searchTypes.forEach((type, i) => {
    perType[type] = perTypeDocs[i];
  });

  const collected: LegalDocument[] = [];
  const seen = new Set<string>();
  const push = (d: LegalDocument) => {
    const key = `${d.doc_type}:${d.source_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      collected.push(d);
    }
  };

  const cap = limit * 2;

  // 1) Matches exatos por número entram primeiro (nunca ficam de fora).
  if (numSet.size) {
    for (const type of searchTypes) {
      for (const d of perType[type] || []) {
        const n = d.metadata?.numero ?? d.metadata?.numero_resolucao;
        if (typeof n === "number" && numSet.has(n)) push(d);
      }
    }
  }

  // 2) Round-robin entre collections: cota justa, impede que uma collection
  // consuma todo o orçamento antes da outra.
  const maxLen = Math.max(0, ...searchTypes.map((t) => (perType[t] || []).length));
  for (let i = 0; i < maxLen && collected.length < cap; i++) {
    for (const type of searchTypes) {
      const list = perType[type] || [];
      if (list[i]) push(list[i]);
      if (collected.length >= cap) break;
    }
  }

  return collected.slice(0, cap);
}

/** Monta o contexto textual para a LLM a partir dos documentos recuperados. */
export function buildContextText(docs: LegalDocument[]): string {
  return docs
    .map((d, i) => {
      const tipo = d.doc_type === "acordao" ? "Acórdão" : "Resolução";
      const numero =
        d.metadata?.numero ?? d.metadata?.numero_resolucao ?? d.source_id;
      const ementa = d.metadata?.ementa || "";
      const relatores = (d.metadata?.relatores || []).join(", ");
      const trecho = (d.content || "").slice(0, 3000);
      return `[${i + 1}] ${tipo} nº ${numero} (source_id: ${d.source_id})
Data da sessão: ${d.metadata?.data_sessao || "-"}
Relator(es): ${relatores || "-"}
Ementa: ${ementa}
Trecho: ${trecho}`;
    })
    .join("\n\n---\n\n");
}
