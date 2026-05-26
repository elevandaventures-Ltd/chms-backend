# @repo/db

Prisma database client for the CHMS monorepo.

## Setup

Set `DATABASE_URL` in the consumer app's environment, e.g.:

```
DATABASE_URL="postgresql://user:password@localhost:5432/chms"
```

## Commands

- `npm run db:generate` — generate the Prisma client
- `npm run db:migrate` — create and apply a dev migration
- `npm run db:deploy` — apply pending migrations (production)
- `npm run db:studio` — open Prisma Studio

## Usage

```ts
import { prisma } from "@repo/db";

const users = await prisma.user.findMany();
```
