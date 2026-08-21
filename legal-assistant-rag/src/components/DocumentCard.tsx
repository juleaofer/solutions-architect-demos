"use client";

import { useState } from "react";
import { FileArchive } from "lucide-react";
import { LegalDocument } from "@/lib/types";

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}

export default function DocumentCard({ doc }: { doc: LegalDocument }) {
  const [showSource, setShowSource] = useState(false);
  const isAcordao = doc.doc_type === "acordao";
  const numero =
    doc.metadata?.numero ?? doc.metadata?.numero_resolucao ?? doc.source_id;
  const tipoLabel = isAcordao ? "Acórdão" : "Resolução";

  return (
    <article className="doc-card">
      <div className="doc-card-head">
        <span className={`doc-badge ${isAcordao ? "acordao" : "resolucao"}`}>
          {tipoLabel}
        </span>
        <span className="doc-title">
          {tipoLabel} nº {numero}
        </span>
      </div>

      <div className="doc-meta">
        <span>
          <b>Sessão:</b> {fmtDate(doc.metadata?.data_sessao)}
        </span>
        <span>
          <b>Publicação:</b> {fmtDate(doc.metadata?.data_publicacao_doe)}
        </span>
      </div>

      <p className="doc-ementa">
        {doc.metadata?.ementa?.trim() || "Ementa não disponível."}
      </p>

      <div className="doc-footer">
        <span className="doc-pages">
          {doc.num_pages ?? 0} página{(doc.num_pages ?? 0) === 1 ? "" : "s"}
        </span>
        <button
          className="btn-source"
          onClick={() => setShowSource((s) => !s)}
        >
          <FileArchive size={15} />
          {showSource ? "Ocultar source" : "Ver source"}
        </button>
      </div>

      {showSource && (
        <div className="source-reveal">{doc.source || "Sem source."}</div>
      )}
    </article>
  );
}
