FROM node:24-slim AS build
WORKDIR /app
# bzip2 is needed to unpack the offline voice model
RUN apt-get update && apt-get install -y --no-install-recommends bzip2 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
# Offline voice model (about 100 MB, downloaded from GitHub). Skip with: --build-arg WITH_VOICE_MODEL=0
# (If you already ran "npm run get-model" on your machine, it is copied in above and not downloaded again.)
ARG WITH_VOICE_MODEL=1
RUN if [ "$WITH_VOICE_MODEL" = "1" ] && [ ! -f public/models/whisper/manifest.json ]; then npm run get-model; fi
RUN npm run build

FROM node:24-slim
WORKDIR /app
# openssl is used by scripts/make-cert.mjs to create the shop's https certificate
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8787 HTTP_PORT=8788 DB_PATH=/data/openpos.db TLS_DIR=/data/tls
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
VOLUME /data
EXPOSE 8787 8788
CMD ["node", "server/index.ts"]
