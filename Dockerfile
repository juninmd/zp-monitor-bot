FROM oven/bun:1.3.13 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --omit=peer

FROM oven/bun:1.3.13-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src
COPY public ./public
COPY knowledge ./knowledge
USER bun
EXPOSE 8091
CMD ["bun", "run", "src/index.ts"]
