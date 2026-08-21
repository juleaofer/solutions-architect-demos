import { NextRequest, NextResponse } from "next/server";
import { findBySourceId } from "@/lib/services/documents";
import { buildGraph } from "@/lib/services/graph";
import { DocType } from "@/lib/mongodb";

/** Busca por source_id (número) numa collection (acordao | resolucao). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as DocType;
  const sourceId = searchParams.get("sourceId")?.trim();

  if (!type || !["acordao", "resolucao"].includes(type)) {
    return NextResponse.json({ error: "type inválido" }, { status: 400 });
  }
  if (!sourceId) {
    return NextResponse.json({ error: "sourceId obrigatório" }, { status: 400 });
  }

  try {
    const documents = await findBySourceId(type, sourceId);
    const graph = buildGraph(documents);
    return NextResponse.json({ documents, graph });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
