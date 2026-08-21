import { getDb, COLLECTIONS, DocType } from "@/lib/mongodb";

/**
 * Sugere nomes completos de relatores a partir de um texto parcial,
 * tolerante a erros de digitação usando Atlas Search (fuzzy).
 */
export async function suggestRelatores(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const db = await getDb();
  const names = new Set<string>();

  for (const type of ["acordao", "resolucao"] as DocType[]) {
    const col = db.collection(COLLECTIONS[type]);
    const pipeline = [
      {
        $search: {
          index: "fulltext",
          text: {
            query: trimmed,
            path: "metadata.relatores",
            fuzzy: { maxEdits: 2, prefixLength: 1 },
          },
        },
      },
      { $limit: 60 },
      { $unwind: "$metadata.relatores" },
      { $group: { _id: "$metadata.relatores" } },
      { $limit: 60 },
    ];
    try {
      const docs = await col.aggregate(pipeline).toArray();
      docs.forEach((d) => d._id && names.add(d._id as string));
    } catch {
      // fallback regex se o índice de search não estiver disponível
      const rx = new RegExp(escapeRegex(trimmed), "i");
      const docs = await col
        .find({ "metadata.relatores": rx })
        .project({ "metadata.relatores": 1 })
        .limit(60)
        .toArray();
      docs.forEach((d) =>
        (d.metadata?.relatores || []).forEach((r: string) => {
          if (rx.test(r)) names.add(r);
        })
      );
    }
  }

  // ranqueia por proximidade textual ao termo digitado
  const upper = trimmed.toUpperCase();
  return Array.from(names)
    .sort((a, b) => {
      const aStarts = a.toUpperCase().startsWith(upper) ? 0 : 1;
      const bStarts = b.toUpperCase().startsWith(upper) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.localeCompare(b);
    })
    .slice(0, 20);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
