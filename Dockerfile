FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY lib/ ./lib/
COPY providers.json ./
COPY config.example.json ./
COPY .env.example ./
COPY bin/ ./bin/

RUN npm install --omit=dev 2>/dev/null || true

ENV PORT=4000
ENV HOST=0.0.0.0
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1

CMD ["node", "server.js"]
