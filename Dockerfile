# Build image
FROM node:20 AS build
# Set container working directory to /app
WORKDIR /app
# Copy npm instructions
COPY package*.json ./
# Set npm cache to a directory the non-root user can access
RUN npm config set cache /app/.npm-cache --global
# Install dependencies with npm ci (exact versions in the lockfile), suppressing warnings
RUN npm ci --loglevel=error
# Copy app (useless stuff is ignored by .dockerignore)
COPY . .
# Optional build metadata overrides for environments where `.git` is not present in build context
ARG CABO_CLIENT_BUILD_COMMIT_ID
ARG CABO_CLIENT_BUILD_COMMIT_TIMESTAMP
ARG CABO_SERVER_BUILD_COMMIT_ID
ARG CABO_SERVER_BUILD_COMMIT_TIMESTAMP
ENV CABO_CLIENT_BUILD_COMMIT_ID=${CABO_CLIENT_BUILD_COMMIT_ID}
ENV CABO_CLIENT_BUILD_COMMIT_TIMESTAMP=${CABO_CLIENT_BUILD_COMMIT_TIMESTAMP}
ENV CABO_SERVER_BUILD_COMMIT_ID=${CABO_SERVER_BUILD_COMMIT_ID}
ENV CABO_SERVER_BUILD_COMMIT_TIMESTAMP=${CABO_SERVER_BUILD_COMMIT_TIMESTAMP}
# Build the app
ENV NEXT_TELEMETRY_DISABLED=1
RUN node --no-opt --max-old-space-size=4096 ./node_modules/next/dist/bin/next build

# Use small production image
FROM node:20-alpine
# Optional build metadata overrides (must also exist in runtime stage)
ARG CABO_CLIENT_BUILD_COMMIT_ID
ARG CABO_CLIENT_BUILD_COMMIT_TIMESTAMP
ARG CABO_SERVER_BUILD_COMMIT_ID
ARG CABO_SERVER_BUILD_COMMIT_TIMESTAMP
# Set the env to "production"
ENV NODE_ENV=production
ENV CABO_CLIENT_BUILD_COMMIT_ID=${CABO_CLIENT_BUILD_COMMIT_ID}
ENV CABO_CLIENT_BUILD_COMMIT_TIMESTAMP=${CABO_CLIENT_BUILD_COMMIT_TIMESTAMP}
ENV CABO_SERVER_BUILD_COMMIT_ID=${CABO_SERVER_BUILD_COMMIT_ID}
ENV CABO_SERVER_BUILD_COMMIT_TIMESTAMP=${CABO_SERVER_BUILD_COMMIT_TIMESTAMP}
# Set container working directory to /app
WORKDIR /app
# Set npm cache to a directory the non-root user can access
RUN npm config set cache /app/.npm-cache --global
# Install runtime dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --loglevel=error
# Copy app build output
COPY --chown=3301:3301 --from=build /app/.next .next
COPY --chown=3301:3301 --from=build /app/public public
COPY --chown=3301:3301 --from=build /app/package.json package.json
# Ensure runtime user can write Next.js image/cache directories
RUN mkdir -p /app/.next/cache/images \
  && chown -R 3301:3301 /app/.next /app/public /app/.npm-cache /app/node_modules \
  && chmod -R u+rwX /app/.next
# Get non-root user
USER 3301
# Expose port for serve
EXPOSE 3000
# Start app
#CMD [ "npx", "serve", "-s", "build" ]
CMD [ "node", "./node_modules/next/dist/bin/next", "start" ]
