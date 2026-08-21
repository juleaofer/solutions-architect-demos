import { getDb, COLLECTIONS, DocType } from "@/lib/mongodb";
import { TCEDocument } from "@/lib/types";

const DOC_PROJECTION = {
  content: 0,
  embedding: 0,
  "metadata.texto_decisao_acordao": 0,
};

function serialize(doc: any): TCEDocument {
  return {
    ...doc,
    _id: doc._id?.toString(),
  } as TCEDocument;
}

/** Busca por source_id (número do documento) numa collection específica. */
export async function findBySourceId(
  type: DocType,
  sourceId: string
): Promise<TCEDocument[]> {
  const db = await getDb();
  const col = db.collection(COLLECTIONS[type]);
  const docs = await col
    .find({ source_id: sourceId }, { projection: DOC_PROJECTION })
    .limit(50)
    .toArray();
  return docs.map(serialize);
}

/** Rebusca documentos por (doc_type, source_id) — usado no reuso por cache. */
export async function findByIds(
  items: { doc_type: string; source_id: string }[]
): Promise<TCEDocument[]> {
  if (!items.length) return [];
  const db = await getDb();
  const byType: Record<string, string[]> = {};
  for (const it of items) {
    (byType[it.doc_type] ||= []).push(it.source_id);
  }
  const out: TCEDocument[] = [];
  for (const type of Object.keys(byType) as DocType[]) {
    if (!COLLECTIONS[type]) continue;
    const docs = await db
      .collection(COLLECTIONS[type])
      .find({ source_id: { $in: byType[type] } }, { projection: { embedding: 0 } })
      .limit(50)
      .toArray();
    out.push(...docs.map(serialize));
  }
  return out;
}

/** Busca documentos que contenham um valor específico numa entidade (drill down). */
export async function findByEntity(
  type: DocType,
  field: string,
  value: string
): Promise<TCEDocument[]> {
  const db = await getDb();
  const col = db.collection(COLLECTIONS[type]);
  const docs = await col
    .find({ [field]: value }, { projection: DOC_PROJECTION })
    .limit(50)
    .toArray();
  return docs.map(serialize);
}

/** Busca documentos por relator, em ambas as collections. */
export async function findByRelator(
  relator: string
): Promise<TCEDocument[]> {
  const db = await getDb();
  const results: TCEDocument[] = [];
  for (const type of ["acordao", "resolucao"] as DocType[]) {
    const col = db.collection(COLLECTIONS[type]);
    const docs = await col
      .find({ "metadata.relatores": relator }, { projection: DOC_PROJECTION })
      .limit(50)
      .toArray();
    results.push(...docs.map(serialize));
  }
  return results;
}

/** Retorna o campo `source` (caminho do arquivo) de um documento. */
export async function getSource(
  type: DocType,
  sourceId: string
): Promise<string | null> {
  const db = await getDb();
  const col = db.collection(COLLECTIONS[type]);
  const doc = await col.findOne(
    { source_id: sourceId },
    { projection: { source: 1 } }
  );
  return doc?.source ?? null;
}
