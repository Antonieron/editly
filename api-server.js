// api-server.js
import express from 'express';
import editly from './index.js';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Создаем директории
const dirs = ['uploads', 'outputs', 'temp'];
dirs.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

// Функция скачивания изображения (без axios)
function downloadImage(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    const request = url.startsWith('https:') ? https : http;
    
    request.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP Error: ${response.statusCode}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        resolve();
      });
      
      file.on('error', (err) => {
        fs.unlink(filepath, () => {}); // Удаляем файл при ошибке
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// API для создания новостного видео
app.post('/api/create-news-video', async (req, res) => {
  console.log('📨 Получен запрос на создание новостного видео');
  
  try {
    const {
      title = '🔥 Важная новость дня',
      backgroundImage,
      duration = 149,
      channelName = '📺 НОВОСТНОЙ КАНАЛ',
      subscribeText = '👆 ПОДПИШИСЬ НА КАНАЛ!',
      newsText = 'Актуальные новости • Подписывайтесь на канал',
      fast = false,
      ttsText = ''
    } = req.body;

    if (!backgroundImage) {
      return res.status(400).json({ 
        error: 'Требуется backgroundImage URL',
        example: {
          title: '🔥 Важная новость дня',
          backgroundImage: 'https://images.unsplash.com/photo-xxxx',
          duration: 149
        }
      });
    }

    const timestamp = Date.now();
    const imageFilename = `bg_${timestamp}.jpg`;
    const videoFilename = `news_${timestamp}.mp4`;
    const imagePath = path.join(__dirname, 'temp', imageFilename);
    const outputPath = path.join(__dirname, 'outputs', videoFilename);

    console.log('⬇️ Скачиваем фоновое изображение...');
    console.log(`📷 URL: ${backgroundImage}`);
    
    await downloadImage(backgroundImage, imagePath);
    console.log('✅ Изображение скачано');

    console.log('🎬 Создаем спецификацию видео...');
    
    // Editly спецификация для новостного видео
    const editSpec = {
      outPath: outputPath,
      width: 1920,
      height: 1080,
      fps: 30,
      fast: fast,
      
      clips: [{
        duration: duration,
        layers: [
          // Фоновое изображение
          {
            type: 'image',
            path: imagePath,
            resizeMode: 'cover'
          },
          
          // Темная накладка для читаемости
          {
            type: 'fill-color',
            color: 'rgba(0,0,0,0.4)'
          },
          
          // Breaking News баннер (верх)
          {
            type: 'title',
            text: '🔥 ВАЖНЫЕ НОВОСТИ • BREAKING NEWS • СРОЧНО 🔥',
            fontSize: 28,
            textColor: 'white',
            backgroundColor: 'rgba(255,0,0,0.9)',
            position: { x: 0.5, y: 0.05, originX: 'center', originY: 'top' }
          },
          
          // Дата (левый верхний угол)
          {
            type: 'title',
            text: '📅 ' + new Date().toLocaleDateString('ru-RU'),
            fontSize: 24,
            textColor: '#ffdf00',
            backgroundColor: 'rgba(0,0,0,0.8)',
            position: { x: 0.05, y: 0.15, originX: 'left', originY: 'top' }
          },
          
          // LIVE индикатор
          {
            type: 'title',
            text: '🔴 LIVE',
            fontSize: 20,
            textColor: 'white',
            backgroundColor: 'rgba(255,0,0,0.9)',
            position: { x: 0.05, y: 0.25, originX: 'left', originY: 'top' }
          },
          
          // Главный заголовок (центр)
          {
            type: 'title',
            text: title,
            fontSize: 52,
            textColor: 'white',
            backgroundColor: 'rgba(0,0,0,0.9)',
            position: { x: 0.5, y: 0.5, originX: 'center', originY: 'center' }
          },
          
          // Название канала (внизу по центру)
          {
            type: 'title',
            text: channelName,
            fontSize: 32,
            textColor: 'white',
            backgroundColor: 'rgba(255,0,0,0.8)',
            position: { x: 0.5, y: 0.85, originX: 'center', originY: 'center' }
          },
          
          // Призыв к подписке (правый нижний угол)
          {
            type: 'title',
            text: subscribeText,
            fontSize: 28,
            textColor: 'black',
            backgroundColor: 'rgba(0,255,0,0.9)',
            position: { x: 0.95, y: 0.95, originX: 'right', originY: 'bottom' }
          }
        ]
      }]
    };

    console.log('🎥 Начинаем рендеринг видео...');
    console.log(`⏱️ Длительность: ${duration} секунд`);
    console.log(`🏃 Быстрый режим: ${fast ? 'включен' : 'выключен'}`);
    
    // Создание видео с помощью Editly
    await editly(editSpec);
    
    console.log('✅ Видео создано успешно!');
    
    // Удаляем временное изображение
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      console.log('🧹 Временные файлы удалены');
    }
    
    // Получаем информацию о созданном видео
    const stats = fs.statSync(outputPath);
    const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`📊 Размер файла: ${fileSizeInMB} MB`);
    
    // Возвращаем успешный ответ
    res.json({
      success: true,
      message: 'Новостное видео создано успешно! 🎬',
      data: {
        filename: videoFilename,
        downloadUrl: `/api/download/${videoFilename}`,
        streamUrl: `/api/stream/${videoFilename}`,
        previewUrl: `/api/preview/${videoFilename}`,
        size: `${fileSizeInMB} MB`,
        duration: duration,
        resolution: '1920x1080',
        title: title,
        channelName: channelName,
        created: new Date().toISOString()
      },
      processing: {
        fastMode: fast,
        renderTime: 'Зависит от длительности и сложности',
        estimated: `${fast ? '~30' : '~120'} секунд для ${duration}с видео`
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка при создании видео:', error);
    res.status(500).json({
      error: 'Ошибка при создании новостного видео',
      message: error.message,
      details: error.stack
    });
  }
});

// API для быстрого превью (низкое качество)
app.post('/api/create-preview', async (req, res) => {
  console.log('🚀 Запрос на создание превью');
  
  const requestBody = {
    ...req.body,
    fast: true,
    duration: Math.min(req.body.duration || 30, 30) // Максимум 30 секунд для превью
  };
  
  // Перенаправляем на основной endpoint с принудительным fast режимом
  req.body = requestBody;
  return app._router.handle({ ...req, url: '/api/create-news-video', method: 'POST' }, res);
});

// Скачивание готового видео
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, 'outputs', filename);
  
  console.log(`📥 Запрос на скачивание: ${filename}`);
  
  if (!fs.existsSync(filepath)) {
    console.log('❌ Файл не найден:', filepath);
    return res.status(404).json({ 
      error: 'Файл не найден',
      filename: filename 
    });
  }
  
  console.log('✅ Отправляем файл для скачивания');
  res.download(filepath, filename);
});

// Стриминг видео для просмотра
app.get('/api/stream/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, 'outputs', filename);
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }
  
  const stat = fs.statSync(filepath);
  const fileSize = stat.size;
  const range = req.headers.range;
  
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filepath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(filepath).pipe(res);
  }
});

// Превью изображения видео (первый кадр)
app.get('/api/preview/:filename', (req, res) => {
  const filename = req.params.filename;
  const videoPath = path.join(__dirname, 'outputs', filename);
  
  if (!fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Видео не найдено' });
  }
  
  // Для простоты возвращаем информацию о файле
  const stats = fs.statSync(videoPath);
  res.json({
    filename: filename,
    size: `${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
    created: stats.birthtime,
    streamUrl: `/api/stream/${filename}`,
    downloadUrl: `/api/download/${filename}`
  });
});

// Список созданных видео
app.get('/api/videos', (req, res) => {
  const outputsDir = path.join(__dirname, 'outputs');
  
  if (!fs.existsSync(outputsDir)) {
    return res.json({ videos: [] });
  }
  
  const files = fs.readdirSync(outputsDir)
    .filter(file => file.endsWith('.mp4'))
    .map(filename => {
      const filepath = path.join(outputsDir, filename);
      const stats = fs.statSync(filepath);
      return {
        filename,
        size: `${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
        created: stats.birthtime,
        downloadUrl: `/api/download/${filename}`,
        streamUrl: `/api/stream/${filename}`
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));
  
  res.json({
    videos: files,
    total: files.length
  });
});

// Главная страница с документацией
app.get('/', (req, res) => {
  res.json({
    message: '🎬 Editly News Video API на Railway',
    version: '1.0.0',
    description: 'API для автоматического создания новостных видео',
    
    endpoints: {
      createVideo: 'POST /api/create-news-video',
      createPreview: 'POST /api/create-preview',
      listVideos: 'GET /api/videos',
      download: 'GET /api/download/:filename',
      stream: 'GET /api/stream/:filename',
      preview: 'GET /api/preview/:filename'
    },
    
    example: {
      endpoint: '/api/create-news-video',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        title: '🔥 Важная новость дня',
        backgroundImage: 'https://images.unsplash.com/photo-xxxx',
        duration: 149,
        channelName: '📺 НОВОСТНОЙ КАНАЛ',
        subscribeText: '👆 ПОДПИШИСЬ НА КАНАЛ!',
        fast: false
      }
    },
    
    features: [
      '🎯 Создание новостных видео по шаблону',
      '⚡ Быстрый режим для превью',
      '📱 Стриминг и скачивание',
      '🎨 Кастомизация титров и стилей',
      '🔄 Автоматическое масштабирование изображений'
    ],
    
    status: 'Готов к работе! 🚀'
  });
});

// Обработка ошибок
app.use((error, req, res, next) => {
  console.error('💥 Серверная ошибка:', error);
  res.status(500).json({
    error: 'Внутренняя ошибка сервера',
    message: error.message
  });
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
  console.log('🎬 ===== EDITLY NEWS VIDEO API =====');
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log('📚 Документация: GET /');
  console.log('🎥 Создание видео: POST /api/create-news-video');
  console.log('✅ Готов к созданию новостных видео!');
  console.log('=====================================');
});

export default app;
