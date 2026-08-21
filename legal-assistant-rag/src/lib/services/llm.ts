interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const API_URL = process.env.LLM_API_URL as string;
const API_KEY = process.env.LLM_API_KEY as string;
const MODEL = process.env.LLM_MODEL || "gpt-5.6-luna";

/** Modelos (família gpt-5 / o-series) que só aceitam o temperature default (1). */
function supportsCustomTemperature(model: string): boolean {
  return !/^(gpt-5|o1|o3|o4)/i.test(model);
}

interface LLMOptions {
  temperature?: number;
  /** Força a resposta como objeto JSON (structured output). */
  jsonMode?: boolean;
}

/** Chama a LLM (GPT-4o-mini via Grove Gateway) com o histórico de mensagens. */
export async function chatCompletion(
  messages: LLMMessage[],
  options: LLMOptions = {}
): Promise<string> {
  if (!API_URL || !API_KEY) {
    throw new Error("Credenciais da LLM não configuradas em .env.local");
  }

  const body: Record<string, any> = {
    model: MODEL,
    messages,
  };
  if (supportsCustomTemperature(MODEL)) {
    body.temperature = options.temperature ?? 0.2;
  }
  if (options.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro na LLM (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

export type { LLMMessage, LLMOptions };
