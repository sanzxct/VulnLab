FROM node:20-alpine
WORKDIR /app
COPY server.js ./
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=4s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/healthz >/dev/null 2>&1 || exit 1
# Runs as root so binding port 80 works on any host (regardless of the host's
# unprivileged-port sysctl). It's an internal-only training container.
CMD ["node", "server.js"]
