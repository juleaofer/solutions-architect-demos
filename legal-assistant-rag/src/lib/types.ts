export interface DocMetadata {
  ementa?: string;
  numero?: number;
  numero_resolucao?: number;
  decisoes?: string[];
  relatores?: string[];
  interessados?: string[];
  processos_relacionados?: string[];
  unidades_jurisdicionadas?: string[];
  classes_subclasses?: string[];
  ano_sessao?: number;
  data_sessao?: string;
  data_publicacao_doe?: string | null;
  nome_presidente?: string;
}

export interface LegalDocument {
  _id: string;
  id: number;
  source: string;
  source_id: string;
  num_pages: number;
  doc_type: string;
  metadata: DocMetadata;
  content?: string;
  score?: number;
}

export type EntityType =
  | "relator"
  | "interessado"
  | "processo"
  | "unidade";

export interface GraphNode {
  id: string;
  label: string;
  type: "documento" | EntityType;
  val?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: LegalDocument[];
}
