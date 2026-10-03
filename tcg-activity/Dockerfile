FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY server.js effects.js reports.js img-cache.js guards.js collection-power.js build.mjs ./
COPY src ./src
COPY public ./public
RUN npm run build
EXPOSE 4441
CMD ["node", "server.js"]
