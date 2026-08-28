# Mercury — Ecommerce Engine

A production-grade ecommerce backend built with TypeScript, Express, and pino.

## Prerequisites

- **Node.js** >= 24.19.0
- **npm** (bundled with Node.js)

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Start development server (hot reload)
npm run dev
```

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Production build via tsc |
| `npm run start` | Start the built production server |
| `npm run lint` | Lint source code |
| `npm run format` | Check formatting |
| `npm run format:fix` | Auto-format code |
| `npm run typecheck` | TypeScript type checking (no emit) |
| `npm run test` | Run tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run clean` | Remove dist/ directory |

## Production Build

```bash
npm run build
npm run start
```

The server binds to the configured `HOST:PORT` (default `0.0.0.0:3000`).

## Docker

```bash
# Build the image
docker build -t mercury .

# Run the container
docker run -p 3000:3000 --env PORT=3000 mercury

# Health check
curl http://localhost:3000/health
```

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and adjust.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime mode (`development`, `production`, `test`) |
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | HTTP server bind address |
| `LOG_LEVEL` | `info` | Pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) |
| `API_VERSION` | `1` | API version string returned by health endpoint |

## API Endpoints

### `GET /health`

Health check endpoint. Returns:

```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2026-08-28T12:00:00.000Z",
  "version": "1"
}
```

### Error Response Format

All errors follow a consistent structure:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

## Verification Checklist

- [ ] `npm install` succeeds with no warnings
- [ ] `npm run lint` exits 0
- [ ] `npm run typecheck` exits 0
- [ ] `npm run test` passes all tests
- [ ] `npm run build` produces `dist/`
- [ ] `npm run start` binds to configured port
- [ ] `GET /health` returns `{ status: "ok", uptime: <number>, timestamp: "<ISO>", version: "1" }`
- [ ] SIGTERM/SIGINT triggers graceful shutdown

## Project Structure

```
mercury/
├── src/
│   ├── index.ts              # Entry point
│   ├── app.ts                # Express app factory
│   ├── config/
│   │   ├── env.ts            # Typed env var accessors
│   │   └── logger.ts         # Pino logger instance
│   ├── errors/
│   │   ├── AppError.ts       # Base error class
│   │   └── errorHandler.ts   # Express error middleware
│   ├── middleware/
│   │   └── requestLogger.ts  # Per-request logging
│   ├── routes/
│   │   └── health.ts         # GET /health endpoint
│   └── __tests__/
│       ├── health.test.ts    # Health endpoint tests
│       └── errorHandler.test.ts  # Error handler tests
├── .env.example
├── .gitignore
├── .prettierrc
├── Dockerfile
├── eslint.config.mjs
├── package.json
├── package-lock.json
├── tsconfig.json
└── tsconfig.build.json
```