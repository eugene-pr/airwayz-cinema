# tsx runs TS directly — no build stage (ARCHITECTURE §2 #6). Context: repo root.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/seat-rules/package.json packages/seat-rules/
RUN npm ci --workspace @cinema/api
COPY packages packages
COPY database database
COPY apps/api apps/api
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["../../node_modules/.bin/tsx", "src/main.ts"]
