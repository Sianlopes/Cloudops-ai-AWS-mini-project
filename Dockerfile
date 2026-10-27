FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
COPY package*.json ./
RUN npm ci --omit=dev && mkdir -p /app/data /app/certs && chown -R node:node /app
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts/migrate.mjs scripts/reset-password.mjs ./scripts/
USER node
EXPOSE 4000
CMD ["node", "server/index.js"]
