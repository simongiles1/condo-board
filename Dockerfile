# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM base AS builder
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
ENV NODE_OPTIONS="--max-old-space-size=3072"
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/uploads /app/data/note-screenshots /app/scripts \
  && chown -R nextjs:nodejs /app

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs drizzle ./drizzle
COPY --chown=nextjs:nodejs scripts/docker-migrate.cjs ./scripts/docker-migrate.cjs
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["./docker-entrypoint.sh"]
