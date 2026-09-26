# mm-web single-service image: vite client build + colyseus server on $PORT.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# public/{audio,data,img} are symlinks in the repo; source uploads do not
# preserve them, so restore them as real dirs — otherwise vite emits a
# dist/ with no game assets and the client 404s on every map/art fetch.
RUN for d in audio data img; do rm -rf public/$d; cp -r $d public/$d; done
RUN npm run build && ls dist/data/maps/*.json dist/index.html > /dev/null

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
# server runtime: code + the data/img trees loadMapBundle reads from ROOT
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
COPY data ./data
COPY img ./img
EXPOSE 8080
CMD ["node", "server/index.js"]
