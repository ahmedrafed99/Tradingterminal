# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine
WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Persist conditions across restarts
VOLUME /app/data

EXPOSE 3001

CMD ["node", "dist/index.js"]
