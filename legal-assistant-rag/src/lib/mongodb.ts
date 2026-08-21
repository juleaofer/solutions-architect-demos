import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI as string;
const dbName = process.env.MONGODB_DB || "legal_assistant";

if (!uri) {
  throw new Error("MONGODB_URI não configurada em .env.local");
}

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

if (process.env.NODE_ENV === "development") {
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export async function getDb(): Promise<Db> {
  const c = await clientPromise;
  return c.db(dbName);
}

export const COLLECTIONS = {
  acordao: "acordaos",
  resolucao: "resolucao",
} as const;

export type DocType = keyof typeof COLLECTIONS;

/**
 * Collections de CHUNKS (v3). Criadas ao lado das originais — a v2 não as
 * referencia, então a recuperação por documento inteiro continua intacta.
 * Cada doc-pai (`acordaos`/`resolucao`) é fatiado em vários chunks aqui, com
 * um vetor (autoEmbed voyage-4-lite) por trecho, melhorando a precisão da busca.
 */
export const CHUNK_COLLECTIONS = {
  acordao: "acordaos_chunks",
  resolucao: "resolucao_chunks",
} as const;

/** Liga/desliga a recuperação por chunks (v3). Fallback automático se off/vazio. */
export const USE_CHUNKS = (process.env.RAG_USE_CHUNKS ?? "true") !== "false";

export default clientPromise;
