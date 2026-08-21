import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/auth";

/**
 * Login simulado da demo: valida usuário/senha fixos e devolve a identidade
 * usada para escopar a memória do agente. Não emite token real (é simulação).
 */
export async function POST(req: NextRequest) {
  try {
    const { username, password } = (await req.json()) as {
      username?: string;
      password?: string;
    };
    const user = authenticate(username ?? "", password ?? "");
    if (!user) {
      return NextResponse.json(
        { error: "Credenciais inválidas" },
        { status: 401 }
      );
    }
    return NextResponse.json({ user });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
