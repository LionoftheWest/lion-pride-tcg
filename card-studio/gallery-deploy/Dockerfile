FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
COPY public-gallery ./public-gallery
EXPOSE 4331
CMD ["node", "src/gallery-server.js"]
