FROM node:22-alpine
WORKDIR /app
COPY apps/rag-engine/package.json ./
COPY apps/rag-engine/package-lock.json ./
RUN npm ci --omit=dev
COPY apps/rag-engine/src ./src
USER node
EXPOSE 4060
# Small, predictable footprint next to the other platform services.
ENV NODE_OPTIONS=--max-old-space-size=128
CMD ["node", "src/server.mjs"]
