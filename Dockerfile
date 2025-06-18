# Dockerfile для Editly на Railway (ИСПРАВЛЕННЫЙ)
FROM node:18-bullseye

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
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
    && rm -rf /var/lib/apt/lists/*

# Рабочая директория
WORKDIR /app

# Копируем package.json
COPY package.json ./

# Устанавливаем зависимости (БЕЗ package-lock.json)
RUN npm install --production --legacy-peer-deps

# Копируем весь проект
COPY . .

# Создаем необходимые директории
RUN mkdir -p uploads outputs temp examples

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=3000
ENV DISPLAY=:99

# Экспонируем порт
EXPOSE 3000

# Запуск с виртуальным дисплеем
CMD ["sh", "-c", "Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 & node api-server.js"]
