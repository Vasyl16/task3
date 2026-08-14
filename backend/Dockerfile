# Production-style image for the "everything in Docker" launch mode
# (docker compose --profile full). The hybrid mode does NOT use this file
# — there the backend runs on the host under `npm run start:dev` with hot
# reload, which is still the better way to actually develop.
#
# Debian slim rather than Alpine on purpose: bcrypt and Prisma both ship
# prebuilt glibc binaries, so this image needs no compiler toolchain.
# Alpine (musl) would force a node-gyp build of bcrypt.

# ---------- build ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Prisma probes the libssl version when it loads; slim images ship
# neither, which makes it warn and guess. Needed here (not just at
# runtime) because the `migrate` stage below runs the CLI from this one.
#
# DL3008 (pin apt versions) is waived deliberately: openssl is exactly
# the package that must be allowed to pick up Debian's security updates.
# Pinning it to an exact patch version would break the build the moment
# that version is superseded — which for a TLS library is backwards. The
# base image tag is pinned, which is where reproducibility belongs.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Copy the manifests AND the Prisma schema before installing: `npm ci`
# runs the postinstall `prisma generate`, which needs the schema present.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma

# Placeholder, not a secret: `prisma generate` never connects, but
# prisma.config.ts resolves env('DATABASE_URL') when the CLI loads it.
# The real URL is supplied at runtime from backend/.env.
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder

RUN npm ci

COPY . .
RUN npm run build

# ---------- migrate ----------
# The build stage plus a default command, used by the one-off `migrate`
# service in docker-compose.yml. It exists as its own target because the
# Prisma CLI is a devDependency: it is present here but deliberately
# pruned out of the runtime image below, so migrations can never be run
# by accident from a serving container.
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------- prune ----------
# Separate stage so the prune doesn't strip the CLI out of `migrate`.
FROM build AS pruned
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

# Prisma's query engine links against OpenSSL, which slim images omit.
# Same deliberate DL3008 waiver as the build stage above.
# hadolint ignore=DL3008
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=pruned /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

# The app mirrors its structured logs here for Promtail to tail; compose
# bind-mounts the host's backend/logs over it. Created (and owned by the
# unprivileged user) up front so the mount isn't root-only.
RUN mkdir -p /app/logs && chown -R node:node /app/logs
USER node

EXPOSE 3000

# Deliberately NOT `prisma migrate deploy && node dist/main`. Applying a
# migration to the remote database is a reviewed action, never a side
# effect of starting a container — see README "Database (Prisma)".
CMD ["node", "dist/main"]
