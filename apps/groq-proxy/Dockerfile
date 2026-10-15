FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/groq-proxy/package.json apps/groq-proxy/package.json
RUN npm install --workspace @enterprise/groq-proxy --include-workspace-root
COPY apps/groq-proxy apps/groq-proxy
RUN npm run build -w @enterprise/groq-proxy

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4030
COPY --from=build /app/apps/groq-proxy/dist ./dist
EXPOSE 4030
CMD ["node", "dist/server.js"]
