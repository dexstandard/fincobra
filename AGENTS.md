# Agent Guidelines

When a task touches only the backend or the frontend, scan only the
relevant directory to save time.

### General
- Pin all `package.json` dependencies to exact versions. Do not use `^` or `~` ranges.
- Typing rules:
  - For each feature, put the shared types in a file named `[feature].types.ts` in the same directory as the main code.
  - When a type is used only inside a single file, define the interface at the top of that file.
  - Use `interface` declarations for object shapes instead of `type` aliases.

## Backend

### Folder overview
- `/backend/src/server.ts` bootstraps the Fastify server and cron scheduler.
- `/backend/src/routes` holds HTTP handlers.
- `/backend/src/repos` contains database repositories.
- `/backend/src/services` encapsulates business logic.
- `/backend/src/jobs` defines scheduled jobs.
- `/backend/src/db` keeps `schema.sql`, migrations, and DB helpers.
- `/backend/test` contains backend tests.

### Data Model
Tables:
- `users` — accounts and encrypted API keys.
- `limit_order` — records of performed trades.
- `portfolio_workflow` — user-configured trading workflows.
- `agent_review_raw_log` — prompt/response history per workflow.
- `agent_review_result` — outcomes and rebalances.

### Config
Environment variables: `DATABASE_URL`, `KEY_PASSWORD`, `GOOGLE_CLIENT_ID`.

### Testing
  - IMPORTANT: AGENT MUST RUN LOCAL PG SERVER TO BE ABLE TO RUN TEST!
  - Check `psql` or `pg_isready` to confirm PostgreSQL is installed; install it if missing.
  - Run tests with
    `DATABASE_URL=postgres://postgres:postgres@localhost:5432/promptswap_test npm --prefix backend test`.
  - `npm run build`

### Guidelines
- Apply schema changes using SQL files in `/backend/src/db/migrations` and run `npm --prefix backend run migrate`.
- Do not modify `schema.sql` when changing the schema.
- The server automatically applies pending migrations on startup.
- Cover backend code, especially API endpoints, with sufficient tests.
- New API endpoints should use the `RATE_LIMITS` presets for rate limiting.
- Use structured logging and include `userId`, `workflowId`, and `execLogId` when available.
- Break down complex functions into reusable utilities and check for existing helpers before adding new ones.
- Reuse existing repository functions or test helpers before writing raw SQL. Add new
  helpers under `backend/test/repos` when necessary.
- All API errors must use `errorResponse` and return `{ "error": "message" }`. Parse upstream service errors (e.g. Binance) into user-friendly messages.
- When adding a new dependency, run `npm --prefix backend audit --audit-level=high` to check for vulnerabilities.

## Frontend

### Folder overview
- `/frontend/src/main.tsx` is the entry point.
- `/frontend/src/components` contains reusable components and forms.
- `/frontend/src/routes` defines route components.
- `/frontend/src/lib` holds shared utilities.
- `/frontend/public` serves static assets.

### Testing
- `npm --prefix frontend run lint`
  (no automated tests yet)

### Guidelines
- Reuse existing components (forms, tables, etc.) for consistent UI and validation.
- Break down complex components into smaller pieces and extract helper functions when needed.
- Surface backend errors by reading the `error` field from responses; avoid relying on alternative shapes.
