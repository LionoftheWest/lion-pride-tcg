FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY server.js build.mjs ./
COPY src ./src
COPY public ./public
RUN npm run build
EXPOSE 4441
CMD ["node", "server.js"]
