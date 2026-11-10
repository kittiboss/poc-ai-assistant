FROM node:22-alpine
WORKDIR /app
COPY apps/vendor-control/package.json ./
COPY apps/vendor-control/package-lock.json ./
RUN npm ci --omit=dev
COPY apps/vendor-control/src ./src
USER node
EXPOSE 4050
CMD ["node", "src/server.mjs"]
