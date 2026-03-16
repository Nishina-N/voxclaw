FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY server.ts ./
RUN npx tsc --outDir dist server.ts || true

EXPOSE 3001
CMD ["node", "-e", "require('ts-node/register'); require('./server.ts')"]
