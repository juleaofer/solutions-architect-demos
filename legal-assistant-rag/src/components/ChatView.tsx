"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Brain, Eraser, Trash2 } from "lucide-react";
import { ChatMessage } from "@/lib/types";

interface ChatViewProps {
  userId: string;
  sessionId: string;
}

export default function ChatView({ userId, sessionId }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [facts, setFacts] = useState<string[]>([]);

  const refreshMemory = useCallback(async () => {
    try {
      const res = await fetch(`/api/memory?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (Array.isArray(data.facts)) setFacts(data.facts);
    } catch {
      /* silencioso: memória é auxiliar da UI */
    }
  }, [userId]);

  async function forgetMemory() {
    if (
      !confirm(
        "Esquecer TUDO sobre este usuário? Remove a memória de curto e longo prazo (simulação)."
      )
    )
      return;
    try {
      await fetch(
        `/api/memory?userId=${encodeURIComponent(userId)}&scope=all`,
        { method: "DELETE" }
      );
      setFacts([]);
      setMessages([]);
    } catch {
      alert("Erro ao limpar a memória.");
    }
  }

  async function clearCache() {
    if (
      !confirm(
        "Limpar o cache de perguntas? As próximas perguntas voltarão a percorrer toda a busca no MongoDB (sem reaproveitar respostas já dadas)."
      )
    )
      return;
    try {
      const res = await fetch("/api/cache", { method: "DELETE" });
      const data = await res.json();
      alert(
        data.ok
          ? `Cache de perguntas limpo (${data.deleted} entrada(s) removida(s)).`
          : "Erro ao limpar o cache."
      );
    } catch {
      alert("Erro ao limpar o cache.");
    }
  }

  useEffect(() => {
    refreshMemory();
  }, [refreshMemory]);

  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, userId, sessionId }),
      });
      const data = await res.json();
      setMessages([
        ...next,
        {
          role: "assistant",
          content: data.answer || data.error || "Sem resposta.",
          sources: data.sources || [],
        },
      ]);
      refreshMemory();
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "Erro ao consultar o assistente." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-toolbar">
        <div className="memory-badge" title="Memória de longo prazo do usuário">
          <Brain size={14} />
          {facts.length
            ? `Memória: ${facts.length} fato(s) lembrado(s)`
            : "Memória: nada lembrado ainda"}
        </div>
        <button
          className="btn-source"
          onClick={forgetMemory}
          title="Remove a memória de curto e longo prazo deste usuário"
        >
          <Eraser size={14} />
          Esquecer memória
        </button>
        <button
          className="btn-source"
          onClick={clearCache}
          title="Esvazia o cache de perguntas (chat_cache) usado para responder perguntas similares mais rápido"
        >
          <Trash2 size={14} />
          Limpar cache
        </button>
      </div>

      {facts.length > 0 && (
        <div className="memory-panel">
          <div className="memory-panel-title">O que o assistente lembra de você</div>
          <ul>
            {facts.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="chat-messages">
        <div className="chat-inner">
          {messages.length === 0 && (
            <div className="empty-state">
              <div className="emblem-lg">AJ</div>
              <h3>Assistente Jurídico Inteligente</h3>
              <p>
                Faça perguntas em linguagem natural sobre acórdãos e resoluções.
                As respostas são geradas por IA com base na jurisprudência do
                Tribunal (busca semântica + busca textual no MongoDB).
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble ${m.role}`}>
              <div className={`chat-avatar ${m.role === "user" ? "usr" : "bot"}`}>
                {m.role === "user" ? "Você" : "AJ"}
              </div>
              <div>
                <div className="chat-text">{m.content}</div>
                {m.sources && m.sources.length > 0 && (
                  <div className="chat-sources">
                    {m.sources.map((s) => {
                      const numero =
                        s.metadata?.numero ??
                        s.metadata?.numero_resolucao ??
                        s.source_id;
                      const tipo =
                        s.doc_type === "acordao" ? "Acórdão" : "Resolução";
                      return (
                        <span
                          className="chat-source-chip"
                          key={`${s.doc_type}-${s.source_id}`}
                        >
                          {tipo} nº {numero}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-bubble assistant">
              <div className="chat-avatar bot">AJ</div>
              <div className="chat-text">
                <span className="typing">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="chat-input-wrap">
        <div className="chat-input-inner">
          <textarea
            className="chat-input"
            rows={1}
            placeholder="Pergunte sobre acórdãos, resoluções, decisões..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            className="btn-primary"
            onClick={send}
            disabled={loading || !input.trim()}
          >
            <Send size={17} />
            Enviar
          </button>
        </div>
      </div>
    </div>
  );
}
