# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=build_proxy --mount=type=secret,id=build_ca \
    node -e 'const fs=require("fs"),cp=require("child_process");const e={...process.env};if(fs.existsSync("/run/secrets/build_proxy")){e.HTTPS_PROXY=fs.readFileSync("/run/secrets/build_proxy","utf8").trim();e.npm_config_https_proxy=e.HTTPS_PROXY;e.npm_config_proxy=e.HTTPS_PROXY;}if(fs.existsSync("/run/secrets/build_ca"))e.NODE_EXTRA_CA_CERTS="/run/secrets/build_ca";e.npm_config_fetch_retries="0";e.npm_config_fetch_timeout="30000";cp.execFileSync("npm",["ci"],{env:e,stdio:"inherit"});'
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
# Runtime dependencies, including the locked TypeScript runner.
RUN --mount=type=secret,id=build_proxy --mount=type=secret,id=build_ca \
    node -e 'const fs=require("fs"),cp=require("child_process");const e={...process.env};if(fs.existsSync("/run/secrets/build_proxy")){e.HTTPS_PROXY=fs.readFileSync("/run/secrets/build_proxy","utf8").trim();e.npm_config_https_proxy=e.HTTPS_PROXY;e.npm_config_proxy=e.HTTPS_PROXY;}if(fs.existsSync("/run/secrets/build_ca"))e.NODE_EXTRA_CA_CERTS="/run/secrets/build_ca";e.npm_config_fetch_retries="0";e.npm_config_fetch_timeout="30000";cp.execFileSync("npm",["ci","--omit=dev"],{env:e,stdio:"inherit"});'
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/migrations ./migrations
COPY --from=build --chown=node:node /app/media ./media
USER node
EXPOSE 3000
CMD ["node","--import","tsx","scripts/start.ts"]
