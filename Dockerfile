FROM oven/bun:1.3.13 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --omit=peer

FROM oven/bun:1.3.13-slim
WORKDIR /app
ARG GIT_SHA=dev
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src
COPY public ./public
COPY assets ./assets
COPY knowledge ./knowledge
USER bun
EXPOSE 8091
CMD ["bun", "run", "src/index.ts"]
