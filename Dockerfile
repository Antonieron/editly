# Dockerfile для Editly на Railway
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

# Копируем package.json и package-lock.json
COPY package*.json ./

# Очищаем npm cache и устанавливаем зависимости
RUN npm cache clean --force
RUN npm install --production --no-optional || npm install --production --legacy-peer-deps

# Копируем весь проект
COPY . .

# Создаем необходимые директории
RUN mkdir -p uploads outputs temp examples

# Переменные окружения
ENV NODE_ENV=production
ENV PORT=3000
ENV DISPLAY=:99
ENV NPM_CONFIG_UNSAFE_PERM=true

# Экспонируем порт
EXPOSE 3000

# Проверяем что API файл существует
RUN ls -la api-server.js || echo "api-server.js не найден!"

# Запуск с виртуальным дисплеем
CMD ["sh", "-c", "Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 & node api-server.js"]
