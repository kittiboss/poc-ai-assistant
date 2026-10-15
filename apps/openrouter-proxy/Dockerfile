FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/openrouter-proxy/package.json apps/openrouter-proxy/package.json
RUN npm install --workspace @enterprise/openrouter-proxy --include-workspace-root
COPY apps/openrouter-proxy apps/openrouter-proxy
RUN npm run build -w @enterprise/openrouter-proxy

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4040
COPY --from=build /app/apps/openrouter-proxy/dist ./dist
EXPOSE 4040
CMD ["node", "dist/server.js"]
