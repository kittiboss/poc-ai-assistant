FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/vendor-console/package.json apps/vendor-console/package.json
RUN npm install --workspace @enterprise/vendor-console --include-workspace-root
COPY apps/vendor-console apps/vendor-console
RUN npm run build -w @enterprise/vendor-console

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=4070 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/vendor-console/.next/standalone ./
COPY --from=build /app/apps/vendor-console/.next/static ./apps/vendor-console/.next/static
# Standalone output does not include public/ (the console's icon).
COPY --from=build /app/apps/vendor-console/public ./apps/vendor-console/public
USER node
EXPOSE 4070
CMD ["node", "apps/vendor-console/server.js"]
