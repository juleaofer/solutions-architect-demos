import { NextRequest, NextResponse } from "next/server";
import { suggestRelatores } from "@/lib/services/relatores";
import { findByRelator } from "@/lib/services/documents";
import { buildGraph } from "@/lib/services/graph";

/** GET ?q=texto -> sugestões de nomes; GET ?relator=Nome -> documentos. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const relator = searchParams.get("relator")?.trim();

  try {
    if (relator) {
      const documents = await findByRelator(relator);
      const graph = buildGraph(documents);
      return NextResponse.json({ documents, graph });
    }
    if (q) {
      const suggestions = await suggestRelatores(q);
      return NextResponse.json({ suggestions });
    }
    return NextResponse.json({ error: "q ou relator obrigatório" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
