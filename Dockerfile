# Dockerfile для Editly на Railway (БЕЗ глобальной установки)
FROM node:18-bullseye

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libxi-dev \
    libglu1-mesa-dev \
    libglew-dev \
    pkg-config \
    xvfb \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем package.json
COPY package.json ./

# Устанавливаем зависимости проекта (включая editly локально)
RUN npm install --omit=dev

# Копируем весь проект
COPY . .

# Создаем директории
RUN mkdir -p uploads outputs temp

# Проверяем что локальный editly установлен
RUN ls -la node_modules/.bin/editly || echo "editly не найден в node_modules"

ENV NODE_ENV=production
ENV PORT=3000
ENV DISPLAY=:99

EXPOSE 3000

# Запуск с виртуальным дисплеем
CMD ["sh", "-c", "Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 & node api-server.js"]
