import { LegalDocument } from "@/lib/types";
import { chatCompletion, LLMMessage } from "@/lib/services/llm";
import { routeQuestion, fastRoute, RouteResult } from "@/lib/services/intent";
import { retrieveContext, buildContextText } from "@/lib/services/rag";
import { runCount } from "@/lib/services/filters";
import { runGraph, runGraphByNumero } from "@/lib/services/graphquery";
import { findByIds } from "@/lib/services/documents";
import {
  lookupByVector,
  lookupBySignature,
  saveToCache,
  computeSignature,
  CachedSource,
} from "@/lib/services/cache";
import {
  loadMemory,
  buildMemoryBlock,
  saveTurn,
  extractAndSaveFacts,
} from "@/lib/services/memory";

const SYSTEM_PROMPT = `Você é um assistente jurídico especializado em jurisprudência (acórdãos e resoluções) consultada no MongoDB.
Responda em português do Brasil, de forma clara, objetiva e formal.
Baseie-se no contexto fornecido, que pode conter documentos (acórdãos/resoluções), um resultado quantitativo já calculado no banco, ou uma rede de relacionamentos.
REGRA OBRIGATÓRIA para resultado quantitativo: se o contexto começar com "RESULTADO QUANTITATIVO", o número informado (campo "Contagem") é o dado oficial e completo — você DEVE responder informando esse número diretamente. NUNCA diga que faltam informações nesse caso; o total já é a resposta e não requer citação de documentos.
Ao usar documentos, cite-os pelo tipo e número (ex: "Acórdão nº 41346").
Você também pode receber um bloco "MEMÓRIA DO USUÁRIO". Use-o para personalizar as respostas e para responder perguntas sobre o próprio usuário (nome, papel, interesses, preferências, contexto de conversas anteriores). Para perguntas pessoais, responda DIRETAMENTE com base na MEMÓRIA, mesmo que não haja documentos relacionados.
Responda que não há informação suficiente APENAS quando a pergunta for sobre documentos/relacionamento e o contexto realmente não contiver o dado — jamais quando houver um RESULTADO QUANTITATIVO ou quando a resposta estiver na MEMÓRIA DO USUÁRIO.`;

function docNumero(d: LegalDocument): number | null {
  return d.metadata?.numero ?? d.metadata?.numero_resolucao ?? null;
}

function toCachedSources(docs: LegalDocument[]): CachedSource[] {
  return docs.map((d) => ({
    doc_type: d.doc_type,
    source_id: d.source_id,
    numero: docNumero(d),
  }));
}

function label(d: LegalDocument): string {
  const tipo = d.doc_type === "acordao" ? "Acórdão" : "Resolução";
  return `${tipo} nº ${docNumero(d) ?? d.source_id}`;
}

/** Executa a intenção roteada e devolve o contexto textual + fontes. */
async function executeRoute(
  route: RouteResult,
  question: string
): Promise<{ contextText: string; sources: LegalDocument[] }> {
  if (route.intent === "count") {
    const c = await runCount(route);
    const porCol = Object.entries(c.byCollection)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    const amostra = c.amostra?.length
      ? `\nAmostra de valores: ${c.amostra.join("; ")}`
      : "";
    const contextText = `RESULTADO QUANTITATIVO (calculado nativamente no MongoDB via aggregation pipeline).
Este é o dado oficial e suficiente para responder à pergunta.
Contagem de "${c.target}" para os filtros informados: ${c.total}.
Detalhe por collection: ${porCol}.${amostra}`;
    return { contextText, sources: [] };
  }

  if (route.intent === "graph" && route.graph) {
    const g =
      typeof route.graph.numero === "number"
        ? await runGraphByNumero(route.graph.numero, route.graph.docType)
        : await runGraph(route.graph.field!, route.graph.value!);
    const ancoraDesc =
      typeof route.graph.numero === "number"
        ? `documento de número ${route.graph.numero}`
        : `${route.graph.field} = "${route.graph.value}"`;
    const ancoraLabels = g.ancoras.map(label).join(", ") || "nenhum";
    const redeLabels = g.rede.slice(0, 20).map(label).join(", ") || "nenhum";
    const contextText = `Consulta de relacionamento (via $graphLookup nativo do MongoDB):
Âncora: ${ancoraDesc}
Documento(s) âncora (${g.ancoras.length}): ${ancoraLabels}
Rede conectada por entidades compartilhadas (processos, relator, interessado, unidade) — ${g.totalRede} documento(s): ${redeLabels}`;
    return { contextText, sources: [...g.ancoras, ...g.rede].slice(0, 24) };
  }

  // semantic é a rota PADRÃO (count e graph são os únicos desvios): busca
  // vetorial pré-filtrada em chunks. Os filtros do roteador (numero/ano_sessao/
  // doc_type + relator/interessado/…) entram como CONSTRAINTS da busca
  // (pré-filtro exato no $vectorSearch + $match pós-fusão), em vez de um find()
  // puro que curto-circuitava a semântica.
  const docs = await retrieveContext(question, 6, route.filters);
  return { contextText: buildContextText(docs), sources: docs };
}

async function callLLM(
  question: string,
  contextText: string,
  history: LLMMessage[],
  memoryBlock = ""
): Promise<string> {
  const messages: LLMMessage[] = [{ role: "system", content: SYSTEM_PROMPT }];
  if (memoryBlock) {
    messages.push({
      role: "system",
      content: `MEMÓRIA DO USUÁRIO (use para personalizar e para responder perguntas sobre o próprio usuário):\n\n${memoryBlock}`,
    });
  }
  messages.push(...history.slice(-4), {
    role: "user",
    content: `Contexto recuperado da base de documentos:\n\n${contextText}\n\nCom base no contexto acima, responda: ${question}`,
  });
  return chatCompletion(messages);
}

export interface Identity {
  userId?: string;
  sessionId?: string;
}

export interface AnswerResult {
  answer: string;
  sources: CachedSource[];
  mode: string;
  cached: boolean;
}

/**
 * Orquestra o fluxo completo. O cache funciona EXATAMENTE como na versão
 * anterior (vector -> assinatura -> execução -> LLM -> grava cache). A memória
 * é puramente ADITIVA: quando há usuário logado, o bloco de memória (curto/longo
 * prazo) é injetado no prompt e cada turno é persistido + fatos duráveis são
 * extraídos — inclusive quando a resposta veio do cache. Nada disso desliga o cache.
 */
export async function answerQuestion(
  question: string,
  history: LLMMessage[] = [],
  identity: Identity = {}
): Promise<AnswerResult> {
  const memoryMode = Boolean(identity.userId && identity.sessionId);
  const userId = identity.userId;
  const sessionId = identity.sessionId;

  // Memória aditiva + fast path do cache disparados EM PARALELO: a leitura de
  // memória (loadMemory) e a busca vetorial no cache (lookupByVector) são
  // independentes, então rodam concorrentes via Promise.all. Assim a latência
  // da leitura de memória fica escondida atrás da busca vetorial — inclusive no
  // HIT de cache-vector, onde o memoryBlock é descartado (replay verbatim) mas
  // não custou nada extra ao caminho crítico. Ambas tratam seus próprios erros
  // internamente (retornam vazio/null), então o Promise.all não rejeita.
  const [mem, vec] = await Promise.all([
    memoryMode
      ? loadMemory(userId!, sessionId!)
      : Promise.resolve({ facts: [], turns: [] }),
    lookupByVector(question),
  ]);
  const memoryBlock = memoryMode ? buildMemoryBlock(mem) : "";

  // Persiste o turno (curto prazo) e extrai fatos duráveis (longo prazo). Roda em
  // BACKGROUND (fire-and-forget): é disparado sem await nos pontos de retorno para
  // não bloquear a resposta — a extração de fatos é uma chamada LLM e não deve
  // segurar o usuário, inclusive em cache hits. saveTurn/extractAndSaveFacts já
  // tratam seus próprios erros internamente, então a promise não rejeita.
  const remember = async (answer: string) => {
    if (!memoryMode) return;
    await saveTurn(userId!, sessionId!, question, answer);
    await extractAndSaveFacts(userId!, question, mem.facts);
  };

  // 1) Fast path: cache semântico por similaridade da pergunta (já resolvido no
  // Promise.all acima). Em um HIT (score >= HIT_THRESHOLD), devolve a resposta
  // cacheada VERBATIM — sem re-síntese via LLM. É o caminho de menor latência.
  // O limiar 0.80 já separa perguntas equivalentes de paráfrases distintas,
  // então o eco literal é seguro aqui.
  if (vec) {
    void remember(vec.answer);
    return { answer: vec.answer, sources: vec.sources, mode: "cache-vector", cached: true };
  }

  // 2) Roteamento de intenção + extração de filtros. fastRoute resolve SEM LLM as
  // perguntas temáticas puras (sem nenhum atributo estrutural a extrair) — nesses
  // casos o roteador LLM devolveria exatamente {semantic, filters:{}}. Só quando
  // há algo a extrair caímos no roteador LLM. Assim o caminho semântico comum
  // passa a ter uma ÚNICA chamada ao modelo (a síntese), em vez de duas.
  const route = fastRoute(question) ?? (await routeQuestion(question));
  const signature = computeSignature(route);

  // 3) Reuso por assinatura: mesma base de filtros + MESMA intenção (e, em
  // contagens, o MESMO countTarget). O lookup já casa signature+intent(+countTarget),
  // então um hit garante intenção idêntica — resta só decidir replay × re-síntese.
  const sig = signature.replace(/\|/g, "")
    ? await lookupBySignature(signature, route.intent, route.countTarget)
    : null;
  if (sig) {
    // Replay VERBATIM quando o resultado é DETERMINÍSTICO sobre os filtros:
    // contagem (mesmo countTarget, já garantido pelo lookup) e grafo dependem só
    // da âncora/filtros — não do fraseado —, então a resposta salva já responde
    // exatamente, sem re-síntese (corta ~7s para sub-segundo). Como o cache-vector
    // roda ANTES e não bateu, um hit de assinatura em "semantic" indica pergunta
    // reformulada sobre a MESMA base com outro aspecto: aí mantemos a re-síntese
    // (adapta a resposta ao aspecto atual — seguro).
    const deterministic = route.intent === "count" || route.intent === "graph";
    if (deterministic) {
      void remember(sig.answer);
      return { answer: sig.answer, sources: sig.sources, mode: "cache-signature", cached: true };
    }
    const baseDocs = await findByIds(sig.sources);
    const contextText = baseDocs.length
      ? buildContextText(baseDocs)
      : `Base reutilizada do cache. Resposta anterior: ${sig.answer}`;
    const answer = await callLLM(question, contextText, history, memoryBlock);
    await saveToCache({ question, route, signature, answer, sources: sig.sources });
    void remember(answer);
    return { answer, sources: sig.sources, mode: "cache-signature", cached: true };
  }

  // 4) Execução nova conforme a intenção.
  const { contextText, sources } = await executeRoute(route, question);
  const answer = await callLLM(question, contextText, history, memoryBlock);
  const cachedSources = toCachedSources(sources);
  await saveToCache({ question, route, signature, answer, sources: cachedSources });
  void remember(answer);
  return { answer, sources: cachedSources, mode: route.intent, cached: false };
}
