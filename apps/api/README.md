# api

Fastify HTTP API for the CHMS backend.

## Commands

- `npm run dev` — start with watch mode via `tsx` (port `3001`)
- `npm run start` — run via `tsx` without watch
- `npm run build` — type-check only (no emit)
- `npm run lint` — lint sources
- `npm run check-types` — type-check without emit

## Environment

- `PORT` — listen port (default `3001`)
- `HOST` — bind address (default `0.0.0.0`)
- `LOG_LEVEL` — Fastify logger level (default `info`)
- `DATABASE_URL` — Postgres connection string (consumed via `@repo/db`)

## Layout

```
src/
  server.ts         # entrypoint: builds the app and calls listen()
  app.ts            # buildApp() factory — register plugins/routes here
  routes/
    health.ts       # GET / and GET /health
```
