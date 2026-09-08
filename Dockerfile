# nucleus-server production image.
#
# Both stages MUST share the same base: bcrypt (node-gyp) and sharp (libvips)
# install glibc (Debian) prebuilt binaries at `npm ci` time, so the node_modules
# built here only work on a glibc runtime of the same architecture. Do not
# switch either stage to an -alpine (musl) image.
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# nest build → dist/. tsconfig pins rootDir to ./src, so the entry point is
# dist/main.js and the CLI datasource is dist/data-source.js — both named
# literally by docker-compose.yml, so neither may move.
RUN npm run build \
  && test -f dist/main.js \
  && test -f dist/data-source.js \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

# /health/live has no dependencies — it only proves the process is serving.
# (curl is not present in -slim; Node 24 has global fetch.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "dist/main"]
