FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps/mock-provider/package.json apps/mock-provider/package.json
RUN npm install --workspace @enterprise/mock-provider --include-workspace-root
COPY apps/mock-provider apps/mock-provider
RUN npm run build -w @enterprise/mock-provider

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4010
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/mock-provider/dist ./dist
EXPOSE 4010
CMD ["node", "dist/server.js"]
