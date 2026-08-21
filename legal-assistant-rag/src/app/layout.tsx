import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Assistente Jurídico — Demo RAG + MongoDB",
  description: "Demonstração de busca inteligente com MongoDB, RAG e GraphRAG",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
