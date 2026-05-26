# chms-backend

Turborepo monorepo for the CHMS project.

## Workspaces

### Apps

- [`apps/web`](apps/web) — Next.js web app (port `3000`)
- [`apps/api`](apps/api) — NestJS HTTP API (port `3001`)

### Packages

- [`packages/db`](packages/db) — Prisma client, schema, and migrations (`@repo/db`)
- [`packages/ui`](packages/ui) — Shared React component library (`@repo/ui`)
- [`packages/eslint-config`](packages/eslint-config) — Shared ESLint configs (`@repo/eslint-config`)
- [`packages/typescript-config`](packages/typescript-config) — Shared `tsconfig.json`s (`@repo/typescript-config`)

## Prerequisites

- Node.js `>= 18`
- npm `>= 11`
- A PostgreSQL instance reachable via `DATABASE_URL` (only needed when using `@repo/db`)

## Getting started

```sh
npm install
npm run db:generate    # generate Prisma client
npm run dev            # start every app in parallel
```

Or run a single app:

```sh
npm run dev:web        # Next.js on http://localhost:3000
npm run dev:api        # NestJS on http://localhost:3001
```

## Common scripts

| Script                 | Purpose                           |
| ---------------------- | --------------------------------- |
| `npm run build`        | Build every workspace             |
| `npm run lint`         | Lint every workspace              |
| `npm run check-types`  | Type-check every workspace        |
| `npm run format`       | Format the repo with Prettier     |
| `npm run format:check` | Verify formatting without writing |
| `npm run db:generate`  | Generate the Prisma client        |
| `npm run db:migrate`   | Create/apply a dev migration      |

## Tooling

- **Turborepo** for task orchestration and caching
- **TypeScript** with shared base configs in `@repo/typescript-config`
- **ESLint** flat config exported from `@repo/eslint-config` (`base`, `next-js`, `react-internal`)
- **Prettier** with shared rules in [`.prettierrc.json`](.prettierrc.json)
