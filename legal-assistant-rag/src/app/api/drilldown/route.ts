import { NextRequest, NextResponse } from "next/server";
import { findByEntity } from "@/lib/services/documents";
import { buildGraph, parseEntityNode } from "@/lib/services/graph";
import { COLLECTIONS, getDb, DocType } from "@/lib/mongodb";
import { LegalDocument } from "@/lib/types";

const DOC_PROJECTION = {
  content: 0,
  embedding: 0,
  "metadata.texto_decisao_acordao": 0,
};

/** Drill down: dado um nó de entidade do grafo, retorna docs relacionados. */
export async function POST(req: NextRequest) {
  try {
    const { nodeId } = await req.json();
    const parsed = parseEntityNode(nodeId);

    let documents: LegalDocument[] = [];

    if (parsed.kind === "entity" && parsed.field && parsed.value) {
      for (const type of ["acordao", "resolucao"] as DocType[]) {
        const docs = await findByEntity(type, parsed.field, parsed.value);
        documents.push(...docs);
      }
    } else if (parsed.kind === "documento" && parsed.sourceId) {
      const db = await getDb();
      const colName =
        parsed.docType === "resolucao"
          ? COLLECTIONS.resolucao
          : COLLECTIONS.acordao;
      const docs = await db
        .collection(colName)
        .find({ source_id: parsed.sourceId }, { projection: DOC_PROJECTION })
        .toArray();
      documents = docs.map((d) => ({ ...d, _id: d._id.toString() } as any));
    }

    const graph = buildGraph(documents);
    return NextResponse.json({ documents, graph });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
