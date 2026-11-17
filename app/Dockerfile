FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# App source (includes the intentionally-exposed git_exposed/.git artifact).
COPY . .

# Uploads dir must be writable by the runtime user.
RUN mkdir -p src/public/uploads && chown -R node:node /app

EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=6 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1

USER node
CMD ["node", "src/server.js"]
