# better-sqlite3 is a native module: build it in a stage that has a toolchain,
# then ship only the compiled result.
FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV DB_PATH=/data/streaks.sqlite
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

CMD ["node", "src/index.js"]
