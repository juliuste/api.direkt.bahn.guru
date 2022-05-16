# install dependencies
FROM node:gallium-alpine
RUN npm i -g pnpm

WORKDIR /app-src

COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY src ./src
RUN pnpm run build-stations

USER node

ENV PORT=3000
CMD ["pnpm", "run", "start"]
