"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
import { DemoUser } from "@/lib/auth";

interface LoginProps {
  onLogin: (user: DemoUser) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        onLogin(data.user as DemoUser);
      } else {
        setError(data.error || "Não foi possível entrar.");
      }
    } catch {
      setError("Erro ao conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="brand-emblem">AJ</div>
          <div>
            <h1>Assistente Jurídico</h1>
            <span>Assistente Inteligente</span>
          </div>
        </div>

        <div className="login-field">
          <label htmlFor="login-user">Usuário</label>
          <input
            id="login-user"
            className="login-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="João"
            autoComplete="username"
          />
        </div>

        <div className="login-field">
          <label htmlFor="login-pass">Senha</label>
          <input
            id="login-pass"
            className="login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••"
            autoComplete="current-password"
          />
        </div>

        {error && <div className="login-error">{error}</div>}

        <button className="btn-primary login-submit" type="submit" disabled={loading}>
          <LogIn size={17} />
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <div className="login-hint">Demonstração — use João / senha 12345.</div>
      </form>
    </div>
  );
}
