# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/
RUN pnpm run build

# Stage 2: Run
FROM node:24-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER appuser

EXPOSE ${PORT:-3000}

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://localhost:${PORT:-3000}/health" || exit 1

CMD ["node", "dist/index.js"]