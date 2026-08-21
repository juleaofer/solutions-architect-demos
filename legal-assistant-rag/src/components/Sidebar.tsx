"use client";

import {
  FileText,
  ScrollText,
  UserSearch,
  MessageSquarePlus,
  Settings,
  LogOut,
  UserCircle2,
} from "lucide-react";

export type ViewKey =
  | "home"
  | "acordao"
  | "resolucao"
  | "relator"
  | "chat"
  | "config";

interface SidebarProps {
  active: ViewKey;
  onSelect: (view: ViewKey) => void;
  onLogout: () => void;
  userName: string;
  onNewConversation: () => void;
}

const NAV = [
  { key: "acordao", label: "Busca por Acórdão", icon: FileText },
  { key: "resolucao", label: "Busca por Resolução", icon: ScrollText },
  { key: "relator", label: "Busca por Relator", icon: UserSearch },
] as const;

export default function Sidebar({
  active,
  onSelect,
  onLogout,
  userName,
  onNewConversation,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="brand-emblem">AJ</div>
          <div className="brand-text">
            <h1>Assistente Jurídico</h1>
            <span>Assistente Inteligente</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Consultas</div>
        {NAV.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`nav-item ${active === key ? "active" : ""}`}
            onClick={() => onSelect(key as ViewKey)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}

        <div className="nav-section-label">Assistente</div>
        <button
          className={`nav-item ${active === "chat" ? "active" : ""}`}
          onClick={onNewConversation}
        >
          <MessageSquarePlus size={18} />
          Iniciar nova conversa
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <UserCircle2 size={20} />
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{userName}</span>
            <span className="sidebar-user-sub">Sessão ativa (simulação)</span>
          </div>
        </div>
        <button
          className={`nav-item ${active === "config" ? "active" : ""}`}
          onClick={() => onSelect("config")}
        >
          <Settings size={18} />
          Configurações
        </button>
        <button className="nav-item" onClick={onLogout}>
          <LogOut size={18} />
          Sair
        </button>
      </div>
    </aside>
  );
}
