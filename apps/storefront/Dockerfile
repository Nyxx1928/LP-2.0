FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable

COPY package.json ./
RUN pnpm install --frozen-lockfile=false

COPY . .
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]
