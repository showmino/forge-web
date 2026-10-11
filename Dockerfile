# Built by CI and run by Forge with a read-only root filesystem: only /tmp is
# writable, so .next/cache is a link to /tmp. Images come through Google's
# mirror of Docker Hub, which does not rate-limit CI runners.
FROM mirror.gcr.io/library/node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM mirror.gcr.io/library/node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build \
 && rm -rf .next/standalone/.next/cache \
 && ln -s /tmp .next/standalone/.next/cache

FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER 65532:65532
EXPOSE 3000
CMD ["server.js"]
