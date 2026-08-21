# Solutions Architect Demos

Coletânea de demonstrações práticas construídas para explorar recursos do **MongoDB Atlas** aplicados a casos reais de arquitetura de soluções: busca vetorial, RAG, GraphRAG, agregações nativas, cache semântico e memória de agentes.

Cada demo é **autocontida** (código, dependências e README próprio) e pode ser executada localmente de forma independente. Os dados usados nos exemplos são genéricos — nenhuma demo contém informações de clientes, credenciais ou datasets proprietários.

## Demos disponíveis

| Demo | Descrição | Principais recursos MongoDB |
|------|-----------|-----------------------------|
| [`legal-assistant-rag`](./legal-assistant-rag) | Assistente jurídico de jurisprudência com RAG de baixa latência: árvore de decisão *cache-first*, roteamento de intenção, contagens nativas e grafo de relacionamentos. | Atlas Vector Search, `$rankFusion`, `$graphLookup`, `$searchMeta`, cache semântico |

> Novas demos serão adicionadas a esta tabela conforme forem construídas.

## Estrutura do repositório

```
solutions-architect-demos/
├── README.md                  # este arquivo (catálogo)
└── legal-assistant-rag/       # demo autocontida (Next.js + MongoDB Atlas)
    ├── README.md              # passo a passo de replicação + arquitetura
    ├── .env.example           # variáveis de ambiente (apenas nomes/placeholders)
    └── src/                   # código-fonte
```

## Como usar

1. Escolha uma demo na tabela acima.
2. Entre na pasta da demo (ex.: `cd legal-assistant-rag`).
3. Siga o **README** da demo — cada um traz pré-requisitos, configuração de ambiente e passos de execução.

## Convenções

- **Sem segredos no repositório**: cada demo traz um `.env.example` com os **nomes** das variáveis; os valores reais ficam em um `.env` local (ignorado pelo git).
- **Dados genéricos**: exemplos e prompts não referenciam clientes, órgãos ou bases de dados reais.
- **Autocontido**: cada demo instala e roda por conta própria, sem dependências cruzadas.

## Licença

Uso demonstrativo/educacional. Consulte cada demo para detalhes específicos.
