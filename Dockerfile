FROM node:24-alpine

WORKDIR /app

# Копируем package.json и prisma-схему ЗАРАНЕЕ
COPY package*.json ./
COPY prisma ./prisma

# Устанавливаем зависимости (postinstall запустит prisma generate)
RUN npm install --omit=dev

# Копируем остальные файлы проекта
COPY . .

CMD ["node", "bot.js"]