FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/gemini-proxy/package.json apps/gemini-proxy/package.json
RUN npm install --workspace @enterprise/gemini-proxy --include-workspace-root
COPY apps/gemini-proxy apps/gemini-proxy
RUN npm run build -w @enterprise/gemini-proxy

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4020
COPY --from=build /app/apps/gemini-proxy/dist ./dist
EXPOSE 4020
CMD ["node", "dist/server.js"]
