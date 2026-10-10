# Royale Club: web + servidor de tiempo real en un solo contenedor.
# Sirve igual en Render, Railway, Fly.io o cualquier VPS con Docker.

# ---- 1) Compilar el cliente ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 2) Imagen final: solo lo necesario para ejecutar ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    TRUST_PROXY=1 \
    DATA_FILE=/data/rooms.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY tsconfig.json ./
# Las mesas y los perfiles se guardan en /data: monta ahí un disco persistente.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "server/index.ts"]
