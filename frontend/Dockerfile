# Production-style image for the "everything in Docker" launch mode
# (docker compose --profile full): Vite builds a static bundle, nginx
# serves it. The hybrid mode does NOT use this file — there the frontend
# runs on the host under `npm run dev` with HMR.

# ---------- build ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Vite inlines VITE_* vars at BUILD time, so these are baked into the
# bundle and cannot be changed by restarting the container — changing
# them means rebuilding the image. They are public by definition (anyone
# can read them in devtools); never add a secret here.
#
# localhost, not the compose service name: this code runs in the user's
# browser on the host, so it reaches the backend through its published
# port, not over the compose network.
ARG VITE_API_URL=http://localhost:3000
ARG VITE_WS_URL=ws://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

COPY . .
RUN npm run build

# ---------- runtime ----------
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
