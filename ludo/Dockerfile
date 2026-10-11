# Ludo: cliente compilado + servidor (API y WebSocket) en un solo contenedor.
# Contexto de construcción: esta carpeta (ludo/).

# ---- 1) Compilar el cliente (necesita las reglas compartidas que viven en el servidor) ----
FROM node:22-slim AS client
WORKDIR /app
COPY server/src/shared ./server/src/shared
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client ./
RUN npm run build

# ---- 2) Imagen final ----
FROM node:22-slim
WORKDIR /app/server
ENV NODE_ENV=production \
    TRUST_PROXY=1 \
    PORT=3002
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/src ./src
COPY server/tsconfig.json ./
COPY --from=client /app/client/build /app/client/build
RUN chown -R node:node /app
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3002)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/index.ts"]
