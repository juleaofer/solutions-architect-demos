"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { GraphData, TCEDocument } from "@/lib/types";
import DocumentList from "./DocumentList";
import RelationshipGraph from "./RelationshipGraph";

interface Props {
  type: "acordao" | "resolucao";
}

export default function SearchView({ type }: Props) {
  const [numero, setNumero] = useState("");
  const [documents, setDocuments] = useState<TCEDocument[]>([]);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<string>();
  const [searched, setSearched] = useState(false);

  const label = type === "acordao" ? "acórdão" : "resolução";

  async function handleSearch() {
    const value = numero.trim();
    if (!value) return;
    setLoading(true);
    setSearched(true);
    setContext(`Resultados para ${label} nº ${value}`);
    try {
      const res = await fetch(
        `/api/search?type=${type}&sourceId=${encodeURIComponent(value)}`
      );
      const data = await res.json();
      setDocuments(data.documents || []);
      setGraph(data.graph || { nodes: [], links: [] });
    } finally {
      setLoading(false);
    }
  }

  async function handleNodeSelect(nodeId: string, nodeLabel: string) {
    setLoading(true);
    setContext(`Documentos relacionados a: ${nodeLabel}`);
    try {
      const res = await fetch("/api/drilldown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId }),
      });
      const data = await res.json();
      setDocuments(data.documents || []);
      setGraph(data.graph || { nodes: [], links: [] });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="search-view">
      <div className="search-bar-wrap">
        <div className="search-input-group">
          <input
            className="search-input"
            type="text"
            inputMode="numeric"
            placeholder={`Digite o número do ${label} (source_id)...`}
            value={numero}
            onChange={(e) =>
              setNumero(e.target.value.replace(/[^0-9]/g, ""))
            }
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button
            className="btn-primary"
            onClick={handleSearch}
            disabled={loading || !numero.trim()}
          >
            <Search size={17} />
            Buscar
          </button>
        </div>
      </div>

      {searched ? (
        <div className="split">
          <div className="split-left">
            <DocumentList
              documents={documents}
              loading={loading}
              context={context}
            />
          </div>
          <div className="split-right">
            <RelationshipGraph data={graph} onNodeSelect={handleNodeSelect} />
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <div className="emblem-lg">AJ</div>
          <h3>Busca por {label}</h3>
          <p>
            Informe o número do {label} para consultar os documentos e explorar
            o grafo de relacionamentos entre relatores, interessados e processos
            relacionados.
          </p>
        </div>
      )}
    </div>
  );
}
