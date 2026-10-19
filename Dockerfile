FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY data ./data
COPY order_import_template.xlsx ./order_import_template.xlsx
COPY README.md ./.env.example ./

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
