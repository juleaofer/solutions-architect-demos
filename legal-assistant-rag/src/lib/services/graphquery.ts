import { getDb, COLLECTIONS, DocType } from "@/lib/mongodb";
import { TCEDocument } from "@/lib/types";
import { GraphField } from "@/lib/services/intent";

function serialize(doc: any): TCEDocument {
  return { ...doc, _id: doc._id?.toString() } as TCEDocument;
}

/** Campos de entidade usados para conectar documentos numa rede de relacionamento. */
const GRAPH_FIELDS: GraphField[] = [
  "processos_relacionados",
  "relatores",
  "interessados",
  "unidades_jurisdicionadas",
];

const NODE_PROJECT = {
  source_id: 1,
  doc_type: 1,
  "metadata.numero": 1,
  "metadata.numero_resolucao": 1,
  "metadata.ementa": 1,
  "metadata.relatores": 1,
  "metadata.processos_relacionados": 1,
  "metadata.interessados": 1,
  "metadata.unidades_jurisdicionadas": 1,
};

export interface GraphQueryResult {
  field: GraphField;
  value: string;
  /** Documentos que citam diretamente a entidade âncora. */
  ancoras: TCEDocument[];
  /** Rede transitiva (documentos conectados via entidades compartilhadas). */
  rede: TCEDocument[];
  totalRede: number;
}

/** Campos de alta cardinalidade: traversal transitivo é caro e sem sentido. */
const HIGH_CARDINALITY: GraphField[] = [
  "relatores",
  "interessados",
  "unidades_jurisdicionadas",
];

/**
 * Consulta de relacionamento usando $graphLookup nativo. A partir dos documentos
 * que citam a entidade âncora, expande os documentos conectados por valores
 * compartilhados no mesmo campo, em ambas as collections (acordaos e resolucao).
 *
 * Para conter o custo (limite de 100MB do $graphLookup em entidades de alta
 * cardinalidade, como um relator com milhares de processos), limitamos o número
 * de âncoras e a profundidade do traversal.
 */
export async function runGraph(
  field: GraphField,
  value: string,
  limit = 40
): Promise<GraphQueryResult> {
  const db = await getDb();
  const path = `metadata.${field}`;
  const anchorMatch = { [path]: value };

  const ancoras: TCEDocument[] = [];
  const redeMap = new Map<string, TCEDocument>();

  for (const type of ["acordao", "resolucao"] as DocType[]) {
    const colName = COLLECTIONS[type];
    const pipeline: any[] = [{ $match: anchorMatch }, { $limit: limit }];

    // processos_relacionados: baixa cardinalidade -> traversal transitivo real.
    // relatores/interessados/unidades: alta cardinalidade -> conexão direta
    // (o próprio $match já são os documentos que compartilham a entidade),
    // evitando o estouro de memória do $graphLookup.
    if (!HIGH_CARDINALITY.includes(field)) {
      pipeline.push({
        $graphLookup: {
          from: colName,
          startWith: `$${path}`,
          connectFromField: path,
          connectToField: path,
          as: "rede",
          maxDepth: 1,
          depthField: "hops",
        },
      });
      pipeline.push({
        $project: {
          ...NODE_PROJECT,
          rede: {
            $map: {
              input: { $slice: ["$rede", 40] },
              as: "r",
              in: {
                source_id: "$$r.source_id",
                doc_type: "$$r.doc_type",
                metadata: {
                  numero: "$$r.metadata.numero",
                  numero_resolucao: "$$r.metadata.numero_resolucao",
                  ementa: "$$r.metadata.ementa",
                },
              },
            },
          },
        },
      });
    } else {
      pipeline.push({ $project: NODE_PROJECT });
    }

    const rows = await db.collection(colName).aggregate(pipeline).toArray();

    for (const row of rows) {
      const { rede, ...anchor } = row as any;
      ancoras.push(serialize(anchor));
      for (const r of rede || []) {
        const key = `${r.doc_type}:${r.source_id}`;
        if (!redeMap.has(key)) redeMap.set(key, serialize(r));
      }
    }
  }

  // remove das "âncoras" o próprio conjunto para não duplicar na rede
  for (const a of ancoras) redeMap.delete(`${a.doc_type}:${a.source_id}`);

  return {
    field,
    value,
    ancoras,
    rede: Array.from(redeMap.values()),
    totalRede: redeMap.size,
  };
}

/**
 * Relacionamento a partir do NÚMERO de um documento (ex.: "relação do Acórdão
 * 35.166"). O número de um documento não é um valor de entidade compartilhada;
 * então resolvemos o documento âncora, extraímos suas entidades reais (processos,
 * relator, interessado, unidade) e expandimos a rede via $graphLookup em cada uma.
 */
export async function runGraphByNumero(
  numero: number,
  docType?: DocType
): Promise<GraphQueryResult> {
  const db = await getDb();
  const types = docType ? [docType] : (["acordao", "resolucao"] as DocType[]);

  // 1) Resolve o documento âncora pelo número.
  let anchor: any = null;
  for (const type of types) {
    const doc = await db.collection(COLLECTIONS[type]).findOne(
      { $or: [{ "metadata.numero": numero }, { "metadata.numero_resolucao": numero }] },
      { projection: { embedding: 0, "metadata.texto_decisao_acordao": 0 } }
    );
    if (doc) {
      anchor = { ...doc, doc_type: type };
      break;
    }
  }

  if (!anchor) {
    return { field: "processos_relacionados", value: String(numero), ancoras: [], rede: [], totalRede: 0 };
  }

  const ancoras = [serialize(anchor)];
  const anchorKey = `${anchor.doc_type}:${anchor.source_id}`;
  const redeMap = new Map<string, TCEDocument>();

  // 2) Para cada entidade do documento âncora, expande a rede por $graphLookup.
  // Profundidade e limites são decididos por runGraph conforme a cardinalidade.
  const MAX_REDE = 60;
  outer: for (const field of GRAPH_FIELDS) {
    const values: string[] = anchor.metadata?.[field] || [];
    for (const value of values) {
      if (!value) continue;
      const g = await runGraph(field, value);
      for (const d of [...g.ancoras, ...g.rede]) {
        const key = `${d.doc_type}:${d.source_id}`;
        if (key !== anchorKey && !redeMap.has(key)) redeMap.set(key, d);
      }
      if (redeMap.size >= MAX_REDE) break outer;
    }
  }

  return {
    field: "processos_relacionados",
    value: String(numero),
    ancoras,
    rede: Array.from(redeMap.values()),
    totalRede: redeMap.size,
  };
}
