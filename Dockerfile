# Undertow: one container serving the editor and the API.
# Build: docker build -t undertow .   Run: see deploy/compose.yml

# ---- editor (static site) ----
FROM node:24-alpine AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html render.html styleguide.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
# The selftest page stays in development; the styleguide ships with the editor.
RUN npm run build

# ---- API ----
FROM node:24-alpine AS api
WORKDIR /api
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:24-alpine
ENV NODE_ENV=production PORT=8787 STATIC_DIR=/app/web
WORKDIR /app/server
COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/dist ./dist
COPY --from=api /api/package.json ./
COPY server/drizzle ./drizzle
COPY --from=web /web/dist /app/web
# Render inputs and outputs (RENDER_DIR). Owned by the runtime user so a fresh volume mounted here is writable.
RUN mkdir -p /app/server/data/renders && chown -R node:node /app/server/data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
# Apply pending migrations, then serve.
CMD ["sh", "-c", "node dist/db/migrate.js && exec node dist/index.js"]
