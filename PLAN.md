# Mercury Ecommerce Engine — Project Skeleton Implementation Plan

> **⚠️ Historical document.** This is the original skeleton implementation plan from the first development task. Many details are outdated (Express 4 → Express 5, pnpm → npm, directory structure has evolved). The authoritative documentation is in `docs/`. This file is preserved for historical context only.

**Author:** Scout (PM)  
**Context:** Parent agent requested a detailed plan for `mercury/` skeleton build.  
**Protocol:** bot-to-bot — no code, just the plan.

---

## 1. Technology Choices and Rationale

|| Concern | Choice | Why |
|---|---|---|---|
| **Runtime** | Node.js 24.19.0 (LTS) | Already available; v24 supports latest JS/TS syntax (isolated declarations, decorators, etc.) |
| **Language** | TypeScript 5.x | Strict mode per PROJECT.md; provides type safety at compile time |
| **Package manager** | pnpm 11.24.0 | Fast, disk-efficient, strict dependency isolation — already available |
| **HTTP framework** | Express 4.x | Simple, well-known, battle-tested — just enough for a skeleton; not over-engineered |
| **Logging** | pino + pino-pretty (dev) | Structured, fast, JSON-based; industry standard for Node services |
| **Config/env** | dotenv + env-var | Read `.env` files + runtime validation/coercion of env vars with typed accessors |
| **Testing** | vitest | TypeScript-native, fast (esbuild-based), compatible with Jest-like API |
| **Linting** | eslint + typescript-eslint | ESLint v9 flat config; semantic linting for TS |
| **Formatting** | prettier | Consistent code style; integrates with ESLint via eslint-config-prettier |
| **Build** | tsc (tsc -b) | TypeScript's own compiler via project references; strict and reliable |
| **Container** | Docker multi-stage | First stage builds, second stage runs from distroless Node image; health checks |

**Deferrals** (intentionally out of scope):
- No frameworks beyond Express (no Fastify, no NestJS — premature)
- No database driver (not needed yet)
- No validation library like zod/joi (env-var is sufficient; zod comes when API input validation is needed)
- No dependency injection container
- No Swagger/OpenAPI docs (too early)
- No CI config (GHA can be added later)

---

## 2. Full Directory Structure

```
mercury/
├── .dockerignore
├── .env.example
├── .gitignore
├── .prettierrc
├── Dockerfile
├── eslint.config.mjs          # Flat config (ESLint v9)
├── package.json
├── pnpm-lock.yaml             # (generated)
├── README.md
├── tsconfig.json              # Root tsconfig (project references)
├── tsconfig.build.json        # Strict build config (excludes tests)
│
└── src/
    ├── index.ts               # Entry point: parse env, create server, start
    ├── app.ts                 # Express app factory (middleware chain, routes, error handler)
    │
    ├── config/
    │   ├── env.ts             # env-var typed accessors
    │   └── logger.ts          # pino instance factory
    │
    ├── errors/
    │   ├── AppError.ts        # Base custom error class (status, code, message)
    │   └── errorHandler.ts    # Express error-handling middleware
    │
    ├── middleware/
    │   └── requestLogger.ts   # Per-request pino logging middleware
    │
    └── routes/
        └── health.ts          # GET /health -> { status, uptime, timestamp, version }
```

---

## 3. File-by-File Specification

### 3.1 `package.json`
- **Purpose:** Project metadata, scripts, dependencies.
- **Scripts:**
  - `dev` — `tsx watch src/index.ts` (fast dev reload)
  - `build` — `tsc -p tsconfig.build.json`
  - `start` — `node dist/index.js`
  - `lint` — `eslint src/`
  - `format` — `prettier --check src/`
  - `format:fix` — `prettier --write src/`
  - `typecheck` — `tsc --noEmit`
  - `test` — `vitest run`
  - `test:watch` — `vitest`
  - `clean` — `rm -rf dist/`
- **Notes:** Private `true`; no `"type": "module"` — default CJS (fewer ecosystem footguns at this stage; switch to ESM when needed).

### 3.2 `tsconfig.json`
- **Purpose:** Base TS config used by IDE and `tsc --noEmit`.
- **Key settings:**
  - `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` (maximum strictness)
  - `target: "ES2022"`, `module: "NodeNext"`, `moduleResolution: "NodeNext"`
  - `outDir: "dist"`, `rootDir: "src"`
  - `sourceMap: true`, `declaration: true`
  - `skipLibCheck: true`

### 3.3 `tsconfig.build.json`
- **Purpose:** Production build config (stricter, excludes tests).
- **Inherits:** `tsconfig.json`
- **Overrides:**
  - `include: ["src"]`
  - `exclude: ["**/*.test.ts", "**/*.spec.ts"]`

### 3.4 `eslint.config.mjs`
- **Purpose:** Flat ESLint v9 config with TypeScript support.
- **Contents:**
  - `@eslint/js` recommended
  - `typescript-eslint` (flat) with `recommended-type-checked`
  - `eslint-config-prettier` (disables ESLint rules that conflict with Prettier)
  - Ignores `dist/`, `node_modules/`, `pnpm-lock.yaml`
  - Parser: `@typescript-eslint/parser` with `project: true`
  - A few opinionated extras: `no-console` (warn — pino replaces console), `@typescript-eslint/explicit-function-return-type` (off — TS infers well enough for now)

### 3.5 `.prettierrc`
- **Purpose:** Prettier formatting rules.
- **Contents:**
  - `semi: true`
  - `singleQuote: true`
  - `trailingComma: "all"`
  - `printWidth: 100`
  - `tabWidth: 2`

### 3.6 `src/config/env.ts`
- **Purpose:** Load and validate environment variables.
- **Key design:** Use `env-var` with typed accessors. Export a frozen `env` object.
- **Variables:**
  - `NODE_ENV` — default `"development"`, validated as `development|production|test`
  - `PORT` — default `3000`, parsed as integer
  - `HOST` — default `"0.0.0.0"`
  - `LOG_LEVEL` — default `"info"`, validated as valid pino level
  - `API_VERSION` — default `"1"`
- **Exports:** `env` object with typed properties.

### 3.7 `src/config/logger.ts`
- **Purpose:** Create and export a pino logger instance.
- **Key design:**
  - Uses `pino` with `level: env.LOG_LEVEL`
  - Transport: in development (`NODE_ENV !== 'production'`), pipe through `pino-pretty`
  - In production, raw JSON output (stdout)
  - Exports `logger: Logger` singleton

### 3.8 `src/errors/AppError.ts`
- **Purpose:** Base custom error class for all application errors.
- **Key design:**
  - Extends `Error`
  - Properties: `statusCode: number`, `code: string` (machine-readable, e.g. `"INTERNAL_ERROR"`), `isOperational: boolean`
  - Static factory methods: `AppError.internal(msg)`, `AppError.notFound(msg)`, etc.
  - `toJSON()` method for serialization (statusCode, code, message — never stack trace)

### 3.9 `src/errors/errorHandler.ts`
- **Purpose:** Express error-handling middleware (4-arg signature).
- **Key design:**
  - If error is `AppError` (operational): respond with its status/code/message
  - If error is unknown: log full error with pino, respond 500 `"Internal Server Error"` (never leak internals)
  - Always return `{ error: { code, message } }` structure

### 3.10 `src/middleware/requestLogger.ts`
- **Purpose:** Log every HTTP request with pino.
- **Key design:**
  - Attach `req.log` (child logger with request ID) for use in downstream handlers
  - Log method, url, status, response time on response finish
  - Use `on-finished` or `res.on('finish')`

### 3.11 `src/routes/health.ts`
- **Purpose:** `GET /health` endpoint.
- **Key design:**
  - Returns JSON: `{ status: "ok", uptime: <seconds>, timestamp: <ISO>, version: "1" }`
  - `version` reads from `env.API_VERSION`
  - `uptime` from `process.uptime()`
  - No dependencies on business modules

### 3.12 `src/app.ts`
- **Purpose:** Express app factory.
- **Key design:**
  - `createApp()` function — makes testing easy (no side effects at import time)
  - Middleware chain: `requestLogger` → JSON body parser → `health` route → 404 catch-all → `errorHandler`
  - Does NOT start the server — that's `index.ts`'s job

### 3.13 `src/index.ts`
- **Purpose:** Entry point — parse env, create logger, create app, start server, register shutdown hooks.
- **Key design:**
  - `main()` function
  - Calls `createApp()`
  - `server.listen(env.PORT, env.HOST)`
  - Registers `SIGTERM` and `SIGINT` handlers:
    - Log shutdown signal
    - Call `server.close()` with a 10-second timeout (force exit after timeout)
    - Flush pino logger synchronously
    - Exit with code 0
  - Export nothing (entry point)

### 3.14 `src/__tests__/health.test.ts`
- **Purpose:** Integration test for health endpoint.
- **Key design:**
  - Use `vitest` + `supertest` (light dev dependency)
  - Creates app via `createApp()`, fires `GET /health`
  - Asserts: status 200, body has `status: "ok"`, `uptime` is number, `timestamp` is ISO string, `version` matches env

### 3.15 `src/__tests__/errorHandler.test.ts`
- **Purpose:** Unit test for error handler middleware.
- **Key design:**
  - Simulate both `AppError` and unknown errors
  - Assert response shape `{ error: { code, message } }`
  - Assert 500 for unknown errors, correct status for AppErrors

### 3.16 `.env.example`
- **Purpose:** Document all env vars without secrets.
- **Contents:**
  ```
  NODE_ENV=development
  PORT=3000
  HOST=0.0.0.0
  LOG_LEVEL=info
  API_VERSION=1
  ```

### 3.17 `.gitignore`
- **Purpose:** Standard Node.js ignores.
- **Contents:** `node_modules/`, `dist/`, `.env`, `*.log`, `.pnpm-store/`, `coverage/`

### 3.18 `.dockerignore`
- **Purpose:** Exclude dev artifacts from Docker build context.
- **Contents:** `node_modules/`, `.git/`, `dist/`, `.env`, `*.log`, `coverage/`

### 3.19 `Dockerfile`
- **Purpose:** Multi-stage build for production image.
- **Stage 1 (builder):** `node:24-alpine`, install pnpm, copy all, `pnpm install`, `pnpm run build`
- **Stage 2 (runner):** `node:24-alpine` (or distroless), copy `dist/` and `node_modules/` (prod only), expose `$PORT`, `HEALTHCHECK` at `/health`, `CMD ["node", "dist/index.js"]`
- **Design:** Install only production deps in final stage; no dev tooling leaks into the image.

### 3.20 `README.md`
- **Purpose:** Developer onboarding.
- **Sections:**
  - Project description (one-liner)
  - Prerequisites (Node, pnpm)
  - Quick start (`pnpm install`, `pnpm run dev`)
  - Available scripts table
  - Production build (`pnpm run build`, `pnpm run start`)
  - Docker (`docker build -t mercury . && docker run ...`)
  - Configuration (env vars table)
  - Verification checklist

---

## 4. Dependencies

### Production Dependencies

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.21 | HTTP server framework |
| `pino` | ^9.x | Structured logging |
| `dotenv` | ^16.x | Load `.env` files |
| `env-var` | ^7.x | Typed, validated env var access |

### Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `typescript` | ^5.7 | TypeScript compiler |
| `@types/express` | ^5.0 | Express type definitions |
| `@types/node` | ^22.x | Node.js type definitions |
| `tsx` | ^4.x | Fast dev server (ts watch runner) |
| `pino-pretty` | ^13.x | Dev log formatting |
| `vitest` | ^3.x | Test runner |
| `supertest` | ^7.x | HTTP integration test assertions |
| `@types/supertest` | ^6.x | SuperTest type definitions |
| `eslint` | ^9.x | Linting |
| `@eslint/js` | ^9.x | ESLint JS rules |
| `typescript-eslint` | ^8.x | TS rules for flat config |
| `eslint-config-prettier` | ^10.x | Disable ESLint rules that conflict with Prettier |
| `prettier` | ^3.x | Code formatter |

**Total:** 5 prod + 13 dev = 18 packages.

---

## 5. Implementation Steps (Dependency Order)

### Step 1: Initialize project
- `mkdir -p src/__tests__ src/config src/errors src/middleware src/routes`
- `pnpm init` → write exact `package.json` from plan

### Step 2: TypeScript config
- Write `tsconfig.json`
- Write `tsconfig.build.json`

### Step 3: Install all dependencies
- `pnpm add express pino dotenv env-var`
- `pnpm add -D typescript @types/express @types/node tsx pino-pretty vitest supertest @types/supertest eslint @eslint/js typescript-eslint eslint-config-prettier prettier`

### Step 4: Lint/format config
- Write `eslint.config.mjs`
- Write `.prettierrc`

### Step 5: Foundation modules (no Express dependency)
- Write `src/config/logger.ts`
- Write `src/config/env.ts`
- Write `src/errors/AppError.ts`

### Step 6: Express layer
- Write `src/middleware/requestLogger.ts`
- Write `src/errors/errorHandler.ts`
- Write `src/routes/health.ts`
- Write `src/app.ts`

### Step 7: Entry point
- Write `src/index.ts`

### Step 8: Tests
- Write `src/__tests__/health.test.ts`
- Write `src/__tests__/errorHandler.test.ts`
- Verify `pnpm run test` passes

### Step 9: Dev experience
- Write `.env.example`
- Write `.gitignore`
- Write `README.md`

### Step 10: Docker
- Write `.dockerignore`
- Write `Dockerfile`

### Step 11: Lint pass
- `pnpm run lint` (should pass; fix any issues)

### Step 12: Build + Verify
- `pnpm run build` (should produce `dist/`)
- `pnpm run start` in background → `curl localhost:3000/health` → verify response
- `kill` the process → verify graceful shutdown (log messages, clean exit)

---

## 6. Testing Strategy

| Layer | Tool | What's Tested |
|---|---|---|
| **Unit** | vitest | `AppError` instantiation, `toJSON()` output, `env-var` schema validation |
| **Integration** | vitest + supertest | `GET /health` returns correct shape; error handler returns correct structure for unknown & AppError cases |
| **Manual** | curl / httpie | Full lifecycle: start, health check, graceful shutdown |

**Guiding principle for the skeleton:** Tests are lightweight sanity checks, not exhaustive. They validate that the middleware chain, error handling, and health endpoint are wired correctly. Detailed unit tests for business logic come with the first business module.

---

## 7. Acceptance Criteria (verbatim from instruction.md)

1. Install dependencies from a clean state — `pnpm install` succeeds with no warnings/errors.
2. Run lint — `pnpm run lint` exits 0.
3. Run typecheck — `pnpm run typecheck` exits 0 (or `tsc --noEmit`).
4. Run tests — `pnpm run test` passes all tests.
5. Run the production build — `pnpm run build` produces `dist/` with compiled JS.
6. Start the built application — `node dist/index.js` binds to the configured port.
7. Verify the health endpoint — `GET /health` returns `{ status: "ok", uptime: <number>, timestamp: "<ISO>", version: "1" }`.
8. Verify graceful shutdown — SIGTERM/SIGINT triggers `server.close()`, log message printed, process exits with code 0.