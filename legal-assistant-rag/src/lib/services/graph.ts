import { TCEDocument, GraphData, GraphNode, GraphLink } from "@/lib/types";

const ENTITY_FIELDS: {
  key: keyof TCEDocument["metadata"];
  type: GraphNode["type"];
  prefix: string;
}[] = [
  { key: "relatores", type: "relator", prefix: "REL" },
  { key: "interessados", type: "interessado", prefix: "INT" },
  { key: "processos_relacionados", type: "processo", prefix: "PROC" },
];

/**
 * Constrói o grafo de relacionamentos a partir de uma lista de documentos,
 * conectando cada documento às suas entidades: relatores, interessados
 * e processos relacionados.
 */
export function buildGraph(docs: TCEDocument[]): GraphData {
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const linkSet = new Set<string>();

  const addNode = (n: GraphNode) => {
    const existing = nodes.get(n.id);
    if (existing) {
      existing.val = (existing.val || 1) + 1;
    } else {
      nodes.set(n.id, { ...n, val: 1 });
    }
  };

  const addLink = (source: string, target: string) => {
    const k = `${source}->${target}`;
    if (!linkSet.has(k)) {
      linkSet.add(k);
      links.push({ source, target });
    }
  };

  for (const doc of docs) {
    const docId = `DOC:${doc.doc_type}:${doc.source_id}`;
    const numero =
      doc.metadata?.numero ?? doc.metadata?.numero_resolucao ?? doc.source_id;
    const tipoLabel = doc.doc_type === "acordao" ? "Acórdão" : "Resolução";
    addNode({
      id: docId,
      label: `${tipoLabel} ${numero}`,
      type: "documento",
    });

    for (const field of ENTITY_FIELDS) {
      const values = (doc.metadata?.[field.key] as string[] | undefined) || [];
      for (const raw of values) {
        const value = String(raw).trim();
        if (!value) continue;
        const entityId = `${field.prefix}:${value}`;
        addNode({ id: entityId, label: value, type: field.type });
        addLink(docId, entityId);
      }
    }
  }

  return { nodes: Array.from(nodes.values()), links };
}

/** Extrai o tipo de entidade e o valor a partir de um id de nó do grafo. */
export function parseEntityNode(nodeId: string): {
  kind: "documento" | "entity";
  field?: string;
  value?: string;
  docType?: string;
  sourceId?: string;
} {
  if (nodeId.startsWith("DOC:")) {
    const [, docType, sourceId] = nodeId.split(":");
    return { kind: "documento", docType, sourceId };
  }
  const idx = nodeId.indexOf(":");
  const prefix = nodeId.slice(0, idx);
  const value = nodeId.slice(idx + 1);
  const map: Record<string, string> = {
    REL: "metadata.relatores",
    INT: "metadata.interessados",
    PROC: "metadata.processos_relacionados",
  };
  return { kind: "entity", field: map[prefix], value };
}
