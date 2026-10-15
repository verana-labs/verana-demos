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

WORKDIR /repo/verifier-chatbot-vs/verifier-chatbot
COPY verifier-chatbot-vs/verifier-chatbot/package.json verifier-chatbot-vs/verifier-chatbot/package-lock.json* ./
RUN npm install
COPY verifier-chatbot-vs/verifier-chatbot/tsconfig.json ./
COPY verifier-chatbot-vs/verifier-chatbot/src/ ./src/
RUN npm run build

FROM node:20-slim
WORKDIR /repo/common/vt-schema
COPY common/vt-schema/package.json ./
COPY --from=builder /repo/common/vt-schema/dist ./dist

WORKDIR /repo/verifier-chatbot-vs/verifier-chatbot
COPY verifier-chatbot-vs/verifier-chatbot/package.json verifier-chatbot-vs/verifier-chatbot/package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /repo/verifier-chatbot-vs/verifier-chatbot/dist ./dist
RUN mkdir -p ./data
EXPOSE 4002
CMD ["node", "dist/index.js"]
