import { DocType } from "@/lib/mongodb";
import { chatCompletion, LLMMessage } from "@/lib/services/llm";

export type IntentType = "count" | "graph" | "semantic";

/** Campos que podem virar filtro estruturado numa query MongoDB. */
export interface QueryFilters {
  doc_type?: DocType;
  numero?: number;
  ano_sessao?: number;
  ano_processo?: number;
  relator?: string;
  decisao?: string;
  processo?: string;
  interessado?: string;
  unidade?: string;
  classe?: string;
}

export type CountTarget =
  | "documentos"
  | "processos"
  | "relatores"
  | "interessados"
  | "unidades";

export type GraphField =
  | "processos_relacionados"
  | "relatores"
  | "interessados"
  | "unidades_jurisdicionadas";

export interface RouteResult {
  intent: IntentType;
  filters: QueryFilters;
  countTarget?: CountTarget;
  /**
   * Âncora do grafo. Pode ser por entidade (field+value, ex.: um processo) ou
   * por número de documento (numero+docType, ex.: "relação do Acórdão 35.166"),
   * caso em que resolvemos o documento e partimos das entidades dele.
   */
  graph?: {
    field?: GraphField;
    value?: string;
    numero?: number;
    docType?: DocType;
  };
}

const ROUTER_SYSTEM = `Você é um roteador de intenção para um assistente jurídico que consulta acórdãos e resoluções no MongoDB.
Analise a pergunta e responda APENAS um objeto JSON (sem texto fora do JSON) com o schema:
{
  "intent": "count" | "graph" | "semantic",
  "filters": {
    "doc_type": "acordao" | "resolucao" | null,
    "numero": number | null,
    "ano_sessao": number | null,
    "ano_processo": number | null,
    "relator": string | null,
    "decisao": string | null,
    "processo": string | null,
    "interessado": string | null,
    "unidade": string | null,
    "classe": string | null
  },
  "countTarget": "documentos" | "processos" | "relatores" | "interessados" | "unidades" | null,
  "graph": {
    "field": "processos_relacionados" | "relatores" | "interessados" | "unidades_jurisdicionadas" | null,
    "value": string | null,
    "numero": number | null,
    "docType": "acordao" | "resolucao" | null
  } | null
}
Regras:
- "count": perguntas quantitativas (quantos, qual a quantidade, total, número de). Defina countTarget conforme o que se conta.
- "graph": perguntas sobre RELACIONAMENTO/conexão entre documentos ou entidades.
  - Se a âncora for uma ENTIDADE (um processo, relator, interessado ou unidade), preencha graph.field e graph.value (ex.: "documentos relacionados ao processo X").
  - Se a âncora for um DOCUMENTO citado pelo número (ex.: "relação entre o Acórdão 35.166 e outros documentos", "o que se conecta ao Acórdão nº 41346"), preencha graph.numero (só o inteiro, sem pontos) e graph.docType, e deixe graph.field e graph.value como null.
- "semantic": é a ROTA PADRÃO — use para TODA pergunta que NÃO for de contagem (count) nem de relacionamento (graph). Inclui perguntas abertas por assunto/tema livre (ex.: "o que o tribunal decide sobre horas extras?") E TAMBÉM perguntas que citam atributos estruturais (doc_type, número, ano da sessão, ano do processo, relator, decisão, processo, interessado, unidade, classe), como "qual o objeto do Acórdão nº 35.166?" ou "liste as resoluções do relator X de 2024". Pedidos como "resuma", "sintetize", "descreva", "liste", "quais" NÃO mudam a intenção: continuam "semantic".
- IMPORTANTE: mesmo quando a intenção é "semantic", SEMPRE preencha em "filters" todos os atributos estruturais explícitos na pergunta — eles são aplicados como PRÉ-FILTRO da busca vetorial (numero/ano_sessao) e como filtro pós-fusão (relator, interessado, etc.). Não classifique como outra coisa por causa disso.
- ano_sessao vs ano_processo: "sessão/julgado/publicado em ANO" -> ano_sessao; "processo(s) iniciado(s)/aberto(s)/autuado(s)/de ANO" -> ano_processo (o ano faz parte do número do processo, ex.: TC/000964/2024).
- Extraia números removendo pontos (ex.: "35.166" -> 35166). Só preencha um filtro se estiver explícito na pergunta; caso contrário use null.
- Nomes de relator/interessado/unidade: copie apenas o nome, SEM títulos como "Conselheiro", "Cons.", "Relator", "Sr." (ex.: "Conselheiro Julival Silva Rocha" -> "Julival Silva Rocha").`;

const FEWSHOT: LLMMessage[] = [
  {
    role: "user",
    content: "Quantos processos o Elias Naif tem?",
  },
  {
    role: "assistant",
    content:
      '{"intent":"count","filters":{"relator":"Elias Naif"},"countTarget":"processos","graph":null}',
  },
  {
    role: "user",
    content: "Qual é o objeto do Acórdão nº 35.166?",
  },
  {
    role: "assistant",
    content:
      '{"intent":"semantic","filters":{"doc_type":"acordao","numero":35166},"countTarget":null,"graph":null}',
  },
  {
    role: "user",
    content: "Quais documentos estão relacionados ao processo TC/506667/2017?",
  },
  {
    role: "assistant",
    content:
      '{"intent":"graph","filters":{},"countTarget":null,"graph":{"field":"processos_relacionados","value":"TC/506667/2017","numero":null,"docType":null}}',
  },
  {
    role: "user",
    content: "Qual a relação entre o Acórdão 35.166 e outros documentos?",
  },
  {
    role: "assistant",
    content:
      '{"intent":"graph","filters":{},"countTarget":null,"graph":{"field":null,"value":null,"numero":35166,"docType":"acordao"}}',
  },
  {
    role: "user",
    content:
      "Liste as resoluções relatadas pelo Conselheiro Julival Silva Rocha de processos iniciados em 2024",
  },
  {
    role: "assistant",
    content:
      '{"intent":"semantic","filters":{"doc_type":"resolucao","relator":"Julival Silva Rocha","ano_processo":2024},"countTarget":null,"graph":null}',
  },
  {
    role: "user",
    content:
      "Quais resoluções relatadas pelo Conselheiro Julival Silva Rocha resultaram de processos iniciados em 2024? Faça um breve resumo de cada uma",
  },
  {
    role: "assistant",
    content:
      '{"intent":"semantic","filters":{"doc_type":"resolucao","relator":"Julival Silva Rocha","ano_processo":2024},"countTarget":null,"graph":null}',
  },
];

function normalize(raw: any): RouteResult {
  const f = raw?.filters || {};
  const clean = <T,>(v: T) => (v === null || v === "" ? undefined : v);
  const filters: QueryFilters = {
    doc_type: clean(f.doc_type),
    numero: clean(f.numero),
    ano_sessao: clean(f.ano_sessao),
    ano_processo: clean(f.ano_processo),
    relator: clean(f.relator),
    decisao: clean(f.decisao),
    processo: clean(f.processo),
    interessado: clean(f.interessado),
    unidade: clean(f.unidade),
    classe: clean(f.classe),
  };
  const intent: IntentType = ["count", "graph", "semantic"].includes(
    raw?.intent
  )
    ? raw.intent
    : "semantic";
  const g = raw?.graph;
  let graph: RouteResult["graph"];
  if (g && g.field && g.value) {
    graph = { field: g.field, value: String(g.value) };
  } else if (g && typeof g.numero === "number") {
    graph = { numero: g.numero, docType: clean(g.docType) };
  }
  return {
    intent,
    filters,
    countTarget: clean(raw?.countTarget),
    graph,
  };
}

// Sinais que EXIGEM o roteador LLM (contagem, grafo, ou algum filtro estrutural
// a extrair). Se NENHUM aparecer, a pergunta é temática pura e o LLM devolveria
// {semantic, filters:{}} — então podemos pular a chamada com segurança.
const ROUTER_SIGNALS: RegExp[] = [
  /\d/, // número de documento, ano, processo (TC/…/AAAA)
  /\b(quant[oa]s?|quantidade|total|n[úu]mero de)\b/i, // count
  /(rela[çc]|relacionad|conectad|conex|v[íi]nculo|vinculad|ligad|\brede\b)/i, // graph
  /(ac[óo]rd[ãa]o|resolu[çc])/i, // doc_type
  /(relator|conselheir|interessad|unidade|jurisdicionad|processo|classe|decis[ãa]o|ac[óo]rd)/i, // entidades/filtros
  /[A-ZÀ-Ý][a-zà-ÿ]+\s+[A-ZÀ-Ý][a-zà-ÿ]+/, // nome próprio (2+ palavras capitalizadas) → provável relator/interessado
];

/**
 * Roteador heurístico (sem LLM) para o caso mais comum: pergunta temática aberta
 * SEM nenhum atributo estrutural a extrair. Nesses casos o roteador LLM devolveria
 * exatamente {intent:"semantic", filters:{}}, então devolvemos isso direto e
 * economizamos uma chamada ao modelo (o caminho semântico fica com 1 LLM, só a
 * síntese). Quando há QUALQUER sinal estrutural (dígito, palavra de count/graph,
 * tipo de documento, entidade ou nome próprio), retorna null e o chamador cai no
 * roteador LLM — conservador de propósito: preferimos rotear a mais do que perder
 * um filtro. Não faz I/O e é síncrono.
 */
export function fastRoute(query: string): RouteResult | null {
  const q = query.trim();
  if (!q) return null;
  if (ROUTER_SIGNALS.some((re) => re.test(q))) return null;
  return { intent: "semantic", filters: {} };
}

/** Classifica a pergunta e extrai filtros estruturados via LLM (JSON mode). */
export async function routeQuestion(query: string): Promise<RouteResult> {
  try {
    const out = await chatCompletion(
      [
        { role: "system", content: ROUTER_SYSTEM },
        ...FEWSHOT,
        { role: "user", content: query },
      ],
      { temperature: 0, jsonMode: true }
    );
    return normalize(JSON.parse(out));
  } catch (e) {
    console.error("routeQuestion falhou, usando semantic:", e);
    return { intent: "semantic", filters: {} };
  }
}
