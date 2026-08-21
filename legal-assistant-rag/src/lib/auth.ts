/**
 * Autenticação SIMULADA para a demo (sem hash/JWT — apenas credenciais fixas).
 * Serve para associar a memória do agente (curto/longo prazo) a uma identidade.
 */
export interface DemoUser {
  userId: string;
  name: string;
}

interface Credential {
  password: string;
  user: DemoUser;
}

// João / senha 12345. Mantemos o userId "user-1" para preservar a memória de
// longo prazo já gravada. Aceita variações de acento/caixa no nome de usuário.
const USERS: Record<string, Credential> = {
  "joao": { password: "12345", user: { userId: "user-1", name: "João" } },
  "joão": { password: "12345", user: { userId: "user-1", name: "João" } },
};

/** Valida as credenciais e devolve o usuário (ou null se inválidas). */
export function authenticate(
  username: string,
  password: string
): DemoUser | null {
  const key = (username || "").trim().toLowerCase();
  const rec = USERS[key];
  if (rec && rec.password === password) return rec.user;
  return null;
}
