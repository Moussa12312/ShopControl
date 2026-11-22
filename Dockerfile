# ============================================================================
# Dockerfile Tout-en-Un (Web Next.js + API NestJS) pour Hugging Face Spaces
# Offre 16 Go de RAM + 2 vCPU Gratuits (port public 7860, API interne 4000)
# ============================================================================

FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

RUN npm ci

COPY tsconfig.base.json ./
COPY packages/shared/ ./packages/shared/
COPY apps/api/ ./apps/api/
COPY apps/web/ ./apps/web/

# 1. Build du package partagé (@shopcontrol/shared)
RUN npm run build --workspace=packages/shared

# 2. Génération des clients Prisma & Build de l'API NestJS
WORKDIR /app/apps/api
RUN npm run db:generate
RUN npm run build

# 3. Build du Frontend Next.js (pointant vers l'API interne sur 127.0.0.1:4000)
WORKDIR /app/apps/web
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_INTERNAL_URL=http://127.0.0.1:4000
RUN npm run build

# ============================================================================
# Image finale d'exécution (Runner)
# ============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_PORT=4000
ENV PORT=7860
ENV API_INTERNAL_URL=http://127.0.0.1:4000

RUN apk add --no-cache openssl dumb-init postgresql-client

COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/src/generated ./apps/api/src/generated
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/next.config.ts ./apps/web/next.config.ts

COPY start-hf.sh /app/start-hf.sh
RUN chmod +x /app/start-hf.sh && mkdir -p /app/uploads /app/apps/api/uploads && chmod -R 777 /app

EXPOSE 7860

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/app/start-hf.sh"]
