# install dependencies
FROM node:erbium-alpine
WORKDIR /app-src

RUN npm i -g pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install

COPY src ./src

USER node

ENV PORT=3000
CMD ["npm", "start"]
