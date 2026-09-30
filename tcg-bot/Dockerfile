# Build stage: compile TypeScript to dist/.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage: only production deps plus the compiled output.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# The "is playing" picture's fonts and icon (playing-card.ts reads ./assets).
COPY src/assets ./assets
CMD ["node", "dist/index.js"]
