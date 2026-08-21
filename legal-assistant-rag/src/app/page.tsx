"use client";

import { useEffect, useState } from "react";
import Sidebar, { ViewKey } from "@/components/Sidebar";
import SearchView from "@/components/SearchView";
import RelatorView from "@/components/RelatorView";
import ChatView from "@/components/ChatView";
import ConfigView from "@/components/ConfigView";
import Login from "@/components/Login";
import { DemoUser } from "@/lib/auth";

const USER_KEY = "demo_user";
const SESSION_KEY = "demo_session";

function newSessionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const TITLES: Record<ViewKey, { title: string; sub: string }> = {
  home: { title: "Bem-vindo", sub: "Selecione uma opção no menu" },
  acordao: {
    title: "Busca por Acórdão",
    sub: "Consulta por número e grafo de relacionamentos",
  },
  resolucao: {
    title: "Busca por Resolução",
    sub: "Consulta por número e grafo de relacionamentos",
  },
  relator: {
    title: "Busca por Relator",
    sub: "Busca inteligente com correção e sugestões",
  },
  chat: {
    title: "Assistente Inteligente",
    sub: "IA + MongoDB (RAG com busca semântica e textual)",
  },
  config: { title: "Configurações", sub: "" },
};

export default function Home() {
  const [view, setView] = useState<ViewKey>("home");
  const [user, setUser] = useState<DemoUser | null>(null);
  const [sessionId, setSessionId] = useState<string>("");
  const [ready, setReady] = useState(false);

  // Reidrata usuário/sessão do localStorage (simulação de sessão persistente).
  useEffect(() => {
    try {
      const rawUser = localStorage.getItem(USER_KEY);
      if (rawUser) {
        setUser(JSON.parse(rawUser) as DemoUser);
        setSessionId(localStorage.getItem(SESSION_KEY) || newSessionId());
      }
    } catch {
      /* ignora localStorage indisponível */
    }
    setReady(true);
  }, []);

  function handleLogin(u: DemoUser) {
    const sid = newSessionId();
    setUser(u);
    setSessionId(sid);
    setView("chat");
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      localStorage.setItem(SESSION_KEY, sid);
    } catch {
      /* ignora */
    }
  }

  function handleLogout() {
    if (!confirm("Deseja realmente sair? (simulação de logout para a demo)")) return;
    setUser(null);
    setSessionId("");
    setView("home");
    try {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignora */
    }
  }

  // Nova conversa = nova sessão (zera a memória de CURTO prazo; a de longo permanece).
  function handleNewConversation() {
    const sid = newSessionId();
    setSessionId(sid);
    setView("chat");
    try {
      localStorage.setItem(SESSION_KEY, sid);
    } catch {
      /* ignora */
    }
  }

  const meta = TITLES[view];

  if (!ready) return null;
  if (!user) return <Login onLogin={handleLogin} />;

  return (
    <div className="app-shell">
      <Sidebar
        active={view}
        onSelect={setView}
        onLogout={handleLogout}
        userName={user.name}
        onNewConversation={handleNewConversation}
      />

      <main className="main">
        <div className="main-topbar">
          <div>
            <h2>{meta.title}</h2>
            {meta.sub && <div className="topbar-sub">{meta.sub}</div>}
          </div>
        </div>

        <div className="main-content">
          {view === "home" && (
            <div className="empty-state">
              <div className="emblem-lg">AJ</div>
              <h3>Assistente Jurídico</h3>
              <p>
                Selecione uma opção no menu à esquerda para iniciar uma consulta
                por acórdão, resolução, relator ou para conversar com o
                assistente inteligente.
              </p>
            </div>
          )}
          {view === "acordao" && <SearchView key="acordao" type="acordao" />}
          {view === "resolucao" && (
            <SearchView key="resolucao" type="resolucao" />
          )}
          {view === "relator" && <RelatorView />}
          {view === "chat" && (
            <ChatView
              key={sessionId}
              userId={user.userId}
              sessionId={sessionId}
            />
          )}
          {view === "config" && <ConfigView />}
        </div>
      </main>
    </div>
  );
}
