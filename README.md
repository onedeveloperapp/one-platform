# ONE · plataforma

ONE é um software para escritórios de contencioso de massa. O primeiro módulo cuida das ações de passageiros contra companhias aéreas (atraso, cancelamento, overbooking e bagagem), do primeiro contato ao protocolo, com o advogado no controle de cada decisão. Vários escritórios dividem a mesma plataforma, cada um isolado no banco.

Este repositório é a plataforma inteira: o app web, os pacotes de domínio e as integrações.

## Documentos

- [`docs/ONE-PLANO-DESENVOLVIMENTO.md`](docs/ONE-PLANO-DESENVOLVIMENTO.md): o plano de desenvolvimento, por marcos (M0 a M6).
- [`CLAUDE.md`](CLAUDE.md): onde o projeto está, as regras de engenharia e os comandos, para pessoas e agentes.
- [`apps/web/CLAUDE.md`](apps/web/CLAUDE.md): convenções do app web.

Os outros arquivos de `docs/` descrevem o produto de onde esta base foi copiada e ficam só como histórico.

## Stack

Monorepo npm workspaces: `apps/web` (Next.js 15, React 19, MUI v9 com MUI X, Tailwind 4) e `packages/*`. Supabase (Postgres com RLS, Auth, Storage), Inngest, Resend, Asaas, Vercel.

Cada integração externa fica atrás de um adaptador com uma implementação real, uma falsa e um teste de contrato (`packages/courts`, `whatsapp`, `signatures`, `flights`, `identity`), então nada no desenvolvimento espera por chave, conta ou aprovação de terceiros.

## Comandos (na raiz)

```bash
npm install              # sempre na raiz
npm run dev              # apps/web em modo desenvolvimento
npm run ci:verify        # tudo que o CI roda: lint, typecheck, testes, build
npm run test:e2e         # Playwright contra o build de produção
npm run test:db:embedded # migrações e pgTAP num PostgreSQL embutido, sem Docker
```

## Ambiente

O app sobe sem nenhuma chave: o site público abre, os formulários dizem que estão fora do ar e a área logada pede login. Para ligar um serviço, copie `apps/web/.env.example` para `apps/web/.env.local` (que nunca entra no git) e preencha só com credencial de desenvolvimento ou de sandbox do ONE.

Nunca aponte uma chave para o serviço de outro produto, e nunca rode os scripts `db:*:remote` antes de existir um projeto Supabase do ONE.

## Publicação

Só pelo GitHub Actions (`.github/workflows/deploy.yml`), por acionamento manual: uma prévia por padrão, produção quando escolhida.

Repositório privado.
