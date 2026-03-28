FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY server.ts ./
COPY secrets_for_skills.example.json ./
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
RUN npx tsc --outDir dist server.ts || true

EXPOSE 3001
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "-e", "require('ts-node/register'); require('./server.ts')"]
