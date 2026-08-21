"use client";

import { LegalDocument } from "@/lib/types";
import DocumentCard from "./DocumentCard";

interface Props {
  documents: LegalDocument[];
  loading: boolean;
  context?: string;
}

export default function DocumentList({ documents, loading, context }: Props) {
  if (loading) {
    return (
      <div className="loading-inline">
        <span className="spinner" />
        Consultando a base de documentos...
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="doc-count">
        Nenhum documento encontrado. Realize uma busca para visualizar os
        resultados.
      </p>
    );
  }

  return (
    <>
      <div className="split-panel-header">Documentos</div>
      {context && <p className="doc-count">{context}</p>}
      <p className="doc-count">
        {documents.length} documento{documents.length === 1 ? "" : "s"}{" "}
        encontrado{documents.length === 1 ? "" : "s"}
      </p>
      {documents.map((doc) => (
        <DocumentCard key={`${doc.doc_type}-${doc._id}`} doc={doc} />
      ))}
    </>
  );
}
