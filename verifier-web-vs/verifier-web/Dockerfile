# Built from the repository root, so the shared module at common/vt-schema is in the context.
# The layout inside the image mirrors the repository, which keeps the file: dependency path
# in package.json identical in both places.
FROM node:20-slim AS builder
WORKDIR /repo/common/vt-schema
COPY common/vt-schema/package.json common/vt-schema/package-lock.json* ./
RUN npm ci
COPY common/vt-schema/tsconfig.json ./
COPY common/vt-schema/src/ ./src/
RUN npm run build

WORKDIR /repo/verifier-web-vs/verifier-web
COPY verifier-web-vs/verifier-web/package.json verifier-web-vs/verifier-web/package-lock.json* ./
RUN npm install
COPY verifier-web-vs/verifier-web/tsconfig.json ./
COPY verifier-web-vs/verifier-web/src/ ./src/
RUN npm run build

FROM node:20-slim
WORKDIR /repo/common/vt-schema
COPY common/vt-schema/package.json ./
COPY --from=builder /repo/common/vt-schema/dist ./dist

WORKDIR /repo/verifier-web-vs/verifier-web
COPY verifier-web-vs/verifier-web/package.json verifier-web-vs/verifier-web/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /repo/verifier-web-vs/verifier-web/dist ./dist
RUN mkdir -p ./data
EXPOSE 4003
CMD ["node", "dist/index.js"]
