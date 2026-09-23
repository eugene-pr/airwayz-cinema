# Vite dev server, proxying /api to the api service (ARCHITECTURE §8). Context: repo root.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/seat-rules/package.json packages/seat-rules/
RUN npm ci --workspace @cinema/web
COPY packages packages
COPY apps/web apps/web
WORKDIR /app/apps/web
EXPOSE 5173
CMD ["../../node_modules/.bin/vite"]
