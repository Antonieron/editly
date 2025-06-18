// api-server.js (ИСПРАВЛЕННЫЙ - без зависимости от index.js)
import express from 'express';
import { spawn } from 'child_process';
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

// Функция скачивания изображения
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
        fs.unlink(filepath, () => {});
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Функция создания видео через CLI editly
function createVideoWithEditly(specPath, outputPath, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [specPath, '--out', outputPath];
    
    if (options.fast) {
      args.push('--fast');
    }
    
    console.log('🎬 Запуск editly CLI:', 'npx editly', args.join(' '));
    
    const editlyProcess = spawn('npx', ['editly', ...args], {
      cwd: __dirname,
      stdio: 'pipe'
    });
    
    let stdout = '';
    let stderr = '';
    
    editlyProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('📹 Editly:', data.toString().trim());
    });
    
    editlyProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('⚠️ Editly error:', data.toString().trim());
    });
    
    editlyProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Editly завершен успешно');
        resolve({ stdout, stderr });
      } else {
        console.error('❌ Editly завершен с ошибкой, код:', code);
        reject(new Error(`Editly exited with code ${code}. Stderr: ${stderr}`));
      }
    });
    
    editlyProcess.on('error', (error) => {
      console.error('💥 Ошибка запуска editly:', error);
      reject(error);
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
      fast = false
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
    const specFilename = `spec_${timestamp}.json5`;
    
    const imagePath = path.join(__dirname, 'temp', imageFilename);
    const outputPath = path.join(__dirname, 'outputs', videoFilename);
    const specPath = path.join(__dirname, 'temp', specFilename);

    console.log('⬇️ Скачиваем фоновое изображение...');
    await downloadImage(backgroundImage, imagePath);
    console.log('✅ Изображение скачано');

    console.log('📝 Создаем JSON5 спецификацию...');
    
    // Создаем JSON5 спецификацию для editly CLI
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
          
          // Темная накладка
          {
            type: 'fill-color',
            color: 'rgba(0,0,0,0.4)'
          },
          
          // Breaking News баннер
          {
            type: 'title',
            text: '🔥 ВАЖНЫЕ НОВОСТИ • BREAKING NEWS • СРОЧНО 🔥',
            fontSize: 28,
            textColor: 'white',
            backgroundColor: 'rgba(255,0,0,0.9)',
            position: { x: 0.5, y: 0.05, originX: 'center', originY: 'top' }
          },
          
          // Дата
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
          
          // Главный заголовок
          {
            type: 'title',
            text: title,
            fontSize: 52,
            textColor: 'white',
            backgroundColor: 'rgba(0,0,0,0.9)',
            position: { x: 0.5, y: 0.5, originX: 'center', originY: 'center' }
          },
          
          // Название канала
          {
            type: 'title',
            text: channelName,
            fontSize: 32,
            textColor: 'white',
            backgroundColor: 'rgba(255,0,0,0.8)',
            position: { x: 0.5, y: 0.85, originX: 'center', originY: 'center' }
          },
          
          // Призыв к подписке
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

    // Сохраняем спецификацию в файл
    fs.writeFileSync(specPath, JSON.stringify(editSpec, null, 2));
    console.log('📄 Спецификация сохранена:', specPath);

    console.log('🎥 Запускаем editly для создания видео...');
    console.log(`⏱️ Длительность: ${duration} секунд`);
    
    // Создаем видео через editly CLI
    await createVideoWithEditly(specPath, outputPath, { fast });
    
    console.log('✅ Видео создано успешно!');
    
    // Удаляем временные файлы
    [imagePath, specPath].forEach(file => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    });
    console.log('🧹 Временные файлы удалены');
    
    // Проверяем что видео создано
    if (!fs.existsSync(outputPath)) {
      throw new Error('Видео файл не был создан');
    }
    
    const stats = fs.statSync(outputPath);
    const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`📊 Размер файла: ${fileSizeInMB} MB`);
    
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

// Простой тест эндпоинт
app.post('/api/test', async (req, res) => {
  console.log('🧪 Тестовый запрос');
  
  try {
    // Проверяем что editly CLI доступен
    const testProcess = spawn('npx', ['editly', '--help'], {
      stdio: 'pipe'
    });
    
    let output = '';
    testProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    testProcess.on('close', (code) => {
      res.json({
        success: true,
        message: 'API сервер работает!',
        editlyAvailable: code === 0,
        editlyOutput: output.substring(0, 200) + '...',
        environment: {
          nodeVersion: process.version,
          platform: process.platform,
          cwd: process.cwd()
        }
      });
    });
    
  } catch (error) {
    res.json({
      success: false,
      message: 'Ошибка тестирования',
      error: error.message
    });
  }
});

// Скачивание видео
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, 'outputs', filename);
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }
  
  res.download(filepath, filename);
});

// Стриминг видео
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

// Главная страница
app.get('/', (req, res) => {
  res.json({
    message: '🎬 Editly News Video API на Railway',
    version: '2.0.0',
    description: 'API для создания новостных видео через editly CLI',
    
    endpoints: {
      test: 'POST /api/test',
      createVideo: 'POST /api/create-news-video',
      download: 'GET /api/download/:filename',
      stream: 'GET /api/stream/:filename'
    },
    
    example: {
      endpoint: '/api/create-news-video',
      method: 'POST',
      body: {
        title: '🔥 Важная новость дня',
        backgroundImage: 'https://images.unsplash.com/photo-xxxx',
        duration: 149,
        fast: false
      }
    },
    
    status: 'Готов к работе! 🚀'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🎬 ===== EDITLY NEWS VIDEO API =====');
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log('🧪 Тест: POST /api/test');
  console.log('🎥 Создание видео: POST /api/create-news-video');
  console.log('✅ Готов к созданию новостных видео!');
  console.log('=====================================');
});

export default app;
