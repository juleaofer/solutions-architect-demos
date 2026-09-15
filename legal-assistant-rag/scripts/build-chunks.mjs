// Ingestor de chunks (v3). Fatia `content` dos docs-pai em trechos com overlap
// e grava em `*_chunks`. NÃO altera as collections originais (acordaos/resolucao).
//
// Uso:
//   node scripts/build-chunks.mjs --type=all --limit=0 --reset
//   node scripts/build-chunks.mjs --type=acordao --limit=200        (piloto)
// Flags: --type=acordao|resolucao|all  --limit=N (0=todos)  --reset (dropa chunks)
//        --chunk-size=2000  --overlap=200  --batch=500
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";

function loadEnv(file = ".env.local") {
  try {
    const txt = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {}
}

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${name}`)) return true;
  return def;
}

const COLLECTIONS = { acordao: "acordaos", resolucao: "resolucao" };
const CHUNK_COLLECTIONS = { acordao: "acordaos_chunks", resolucao: "resolucao_chunks" };

/** Divide texto em chunks de ~`size` chars com `overlap`, quebrando em fronteira suave. */
function splitText(text, size, overlap) {
  if (!text) return [];
  const n = text.length;
  if (n <= size) return [text.trim()].filter(Boolean);
  const out = [];
  const stride = Math.max(1, size - overlap);
  let start = 0;
  while (start < n) {
    let end = Math.min(start + size, n);
    if (end < n) {
      const windowStart = Math.max(start + stride, start + size - 300);
      const slice = text.slice(windowStart, end);
      const rel = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf("\n"),
        slice.lastIndexOf(". ")
      );
      if (rel > 0) end = windowStart + rel + 1;
    }
    const piece = text.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= n) break;
    start = Math.max(0, end - overlap);
  }
  return out;
}

function chunkDocsFor(doc, type, size, overlap) {
  const pieces = splitText(doc.content || "", size, overlap);
  const meta = { ...(doc.metadata || {}) };
  delete meta.texto_decisao_acordao; // campo enorme: fora do chunk
  return pieces.map((content, i) => ({
    parent_oid: doc._id,
    source_id: doc.source_id,
    doc_type: type,
    source: doc.source ?? null,
    num_pages: doc.num_pages ?? null,
    chunk_index: i,
    n_chunks: pieces.length,
    content,
    metadata: meta,
  }));
}

async function run() {
  loadEnv();
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "legal_assistant";
  if (!uri) throw new Error("MONGODB_URI ausente (.env.local)");

  const type = String(arg("type", "all"));
  const limit = parseInt(String(arg("limit", "0")), 10) || 0;
  const size = parseInt(String(arg("chunk-size", "2000")), 10) || 2000;
  const overlap = parseInt(String(arg("overlap", "200")), 10) || 200;
  const batch = parseInt(String(arg("batch", "500")), 10) || 500;
  const reset = Boolean(arg("reset", false));
  const types = type === "all" ? ["acordao", "resolucao"] : [type];

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  console.log(`db=${dbName} types=${types} limit=${limit || "todos"} size=${size} overlap=${overlap} reset=${reset}`);

  for (const t of types) {
    const src = db.collection(COLLECTIONS[t]);
    const dst = db.collection(CHUNK_COLLECTIONS[t]);
    if (reset) {
      await dst.drop().catch(() => {});
      console.log(`[${t}] chunk collection dropada`);
    }
    const cursor = src.find({}, { projection: { "metadata.texto_decisao_acordao": 0, embedding: 0 } });
    if (limit) cursor.limit(limit);

    let seenDocs = 0, madeChunks = 0, buf = [];
    const flush = async () => {
      if (!buf.length) return;
      await dst.insertMany(buf, { ordered: false });
      madeChunks += buf.length;
      buf = [];
    };
    for await (const doc of cursor) {
      seenDocs++;
      if (!reset) await dst.deleteMany({ source_id: doc.source_id, doc_type: t }); // idempotente por pai
      buf.push(...chunkDocsFor(doc, t, size, overlap));
      if (buf.length >= batch) await flush();
      if (seenDocs % 2000 === 0) console.log(`[${t}] docs=${seenDocs} chunks=${madeChunks + buf.length}`);
    }
    await flush();
    console.log(`[${t}] DONE docs=${seenDocs} chunks=${madeChunks} (avg ${(madeChunks / Math.max(1, seenDocs)).toFixed(2)}/doc)`);
  }
  await client.close();
  console.log("OK");
}

run().catch((e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
