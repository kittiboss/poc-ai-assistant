FROM node:22-alpine
WORKDIR /app
COPY apps/vendor-control/package.json ./
COPY apps/vendor-control/package-lock.json ./
RUN npm ci --omit=dev
COPY apps/vendor-control/src ./src
COPY apps/vendor-control/public ./public
USER node
EXPOSE 4050
CMD ["node", "src/server.mjs"]
