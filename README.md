# chms-backend

Turborepo monorepo for the CHMS project.

## Workspaces

### Apps

- [`apps/web`](apps/web) — Next.js web app (port `3000`)
- [`apps/api`](apps/api) — Fastify HTTP API (port `3001`)

### Packages

- [`packages/db`](packages/db) — Supabase client (`@repo/db`)
- [`packages/ui`](packages/ui) — Shared React component library (`@repo/ui`)
- [`packages/eslint-config`](packages/eslint-config) — Shared ESLint configs (`@repo/eslint-config`)
- [`packages/typescript-config`](packages/typescript-config) — Shared `tsconfig.json`s (`@repo/typescript-config`)

### Database

- [`supabase/`](supabase) — Supabase local project (config + SQL migrations). Schema lives in [`supabase/migrations`](supabase/migrations).

## Prerequisites

- Node.js `>= 18`
- npm `>= 11`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (required for `supabase start`)

## Getting started

```sh
npm install
npm run supabase:start   # boots local Postgres + Studio (first run downloads images)
npm run dev              # start every app in parallel
```

After `supabase:start` finishes it prints `API URL`, `anon key`, and `service_role key`. Copy them into `.env.local` (or per-app `.env`) as:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Studio is at <http://127.0.0.1:54323>. The three initial tables (`churches`, `users`, `user_roles`) should be visible under the `public` schema.

Or run a single app:

```sh
npm run dev:web        # Next.js on http://localhost:3000
npm run dev:api        # Fastify on http://localhost:3001
```

## Common scripts

| Script                          | Purpose                                       |
| ------------------------------- | --------------------------------------------- |
| `npm run build`                 | Build every workspace                         |
| `npm run lint`                  | Lint every workspace                          |
| `npm run check-types`           | Type-check every workspace                    |
| `npm run format`                | Format the repo with Prettier                 |
| `npm run format:check`          | Verify formatting without writing             |
| `npm run supabase:start`        | Start the local Supabase stack (Docker)       |
| `npm run supabase:stop`         | Stop the local Supabase stack                 |
| `npm run supabase:status`       | Print URLs and keys for the local stack       |
| `npm run supabase:reset`        | Drop the local DB and re-apply all migrations |
| `npm run supabase:migration:new <name>` | Create a new timestamped migration file |

## Tooling

- **Turborepo** for task orchestration and caching
- **Supabase CLI** for local Postgres, Auth, Studio, and SQL migrations
- **TypeScript** with shared base configs in `@repo/typescript-config`
- **ESLint** flat config exported from `@repo/eslint-config` (`base`, `next-js`, `react-internal`)
- **Prettier** with shared rules in [`.prettierrc.json`](.prettierrc.json)
