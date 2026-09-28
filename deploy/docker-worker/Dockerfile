# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY packages ./packages
COPY examples/rest-service ./examples/rest-service
COPY tsconfig.base.json tsconfig.json ./
RUN npm install
RUN npx tsc -b packages/core packages/ffmpeg packages/sdk examples/rest-service
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    VEXA_REST_HOST=0.0.0.0 \
    VEXA_REST_PORT=4190 \
    VEXA_WORKER_CONCURRENCY=2 \
    VEXA_REST_WORKSPACE=/var/lib/vexa
VOLUME ["/var/lib/vexa"]
EXPOSE 4190
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:4190/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "examples/rest-service/dist/index.js"]
