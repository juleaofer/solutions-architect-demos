"use client";

import { useState, useRef, useEffect } from "react";
import { UserSearch, User } from "lucide-react";
import { GraphData, LegalDocument } from "@/lib/types";
import DocumentList from "./DocumentList";
import RelationshipGraph from "./RelationshipGraph";

export default function RelatorView() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [graph, setGraph] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(false);
  const [loadingSug, setLoadingSug] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (selected) return;
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoadingSug(true);
      try {
        const res = await fetch(`/api/relatores?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSuggestions(data.suggestions || []);
        setShowSuggestions(true);
      } finally {
        setLoadingSug(false);
      }
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [query, selected]);

  async function selectRelator(name: string) {
    setSelected(name);
    setQuery(name);
    setShowSuggestions(false);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/relatores?relator=${encodeURIComponent(name)}`
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
        <div className="autocomplete">
          <div className="search-input-group">
            <input
              className="search-input"
              type="text"
              placeholder="Digite o nome do relator (aceita nome parcial)..."
              value={query}
              onChange={(e) => {
                setSelected(null);
                setQuery(e.target.value.replace(/[^A-Za-zÀ-ÿ\s]/g, ""));
              }}
              onFocus={() => suggestions.length && setShowSuggestions(true)}
            />
          </div>
          {showSuggestions && (
            <div className="suggestion-list">
              {loadingSug && (
                <div className="suggestion-item">
                  <span className="spinner" /> Buscando nomes...
                </div>
              )}
              {!loadingSug && suggestions.length === 0 && (
                <div className="suggestion-item">
                  Nenhum relator encontrado.
                </div>
              )}
              {suggestions.map((name) => (
                <div
                  key={name}
                  className="suggestion-item"
                  onClick={() => selectRelator(name)}
                >
                  <User size={15} />
                  {name}
                </div>
              ))}
            </div>
          )}
        </div>
        {!selected && (
          <p className="suggestion-hint">
            Selecione um nome da lista para ver todos os processos do relator.
          </p>
        )}
      </div>

      {selected ? (
        <div className="split">
          <div className="split-left">
            <DocumentList
              documents={documents}
              loading={loading}
              context={`Processos do relator: ${selected}`}
            />
          </div>
          <div className="split-right">
            <RelationshipGraph data={graph} onNodeSelect={handleNodeSelect} />
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <div className="emblem-lg">
            <UserSearch size={40} />
          </div>
          <h3>Busca por Relator</h3>
          <p>
            Digite o nome do relator. A busca é tolerante a erros de digitação e
            nomes parciais — selecione o nome completo na lista de sugestões.
          </p>
        </div>
      )}
    </div>
  );
}
