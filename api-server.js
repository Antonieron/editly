// api-server.js (АЛЬТЕРНАТИВА - без editly, только FFmpeg)
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

// Создание видео через FFmpeg напрямую
function createVideoWithFFmpeg(imagePath, outputPath, options) {
  return new Promise((resolve, reject) => {
    const {
      title = '🔥 Важная новость дня',
      duration = 149,
      channelName = '📺 НОВОСТНОЙ КАНАЛ',
      subscribeText = '👆 ПОДПИШИСЬ НА КАНАЛ!',
      fast = false
    } = options;

    // FFmpeg команда для создания видео из изображения
    const ffmpegArgs = [
      '-loop', '1',
      '-i', imagePath,
      '-f', 'lavfi',
      '-i', 'color=black:1920x1080:d=' + duration,
      '-filter_complex', `
        [0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080[bg];
        [bg]drawbox=x=0:y=0:w=1920:h=100:color=red@0.9:t=fill[bg1];
        [bg1]drawtext=text='🔥 ВАЖНЫЕ НОВОСТИ • BREAKING NEWS • СРОЧНО 🔥':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=25[bg2];
        [bg2]drawtext=text='📅 ${new Date().toLocaleDateString('ru-RU')}':fontsize=24:fontcolor=yellow:x=50:y=150[bg3];
        [bg3]drawtext=text='🔴 LIVE':fontsize=20:fontcolor=white:x=50:y=200:box=1:boxcolor=red@0.9:boxborderw=5[bg4];
        [bg4]drawtext=text='${title}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.9:boxborderw=10[bg5];
        [bg5]drawtext=text='${channelName}':fontsize=32:fontcolor=white:x=(w-text_w)/2:y=h-200:box=1:boxcolor=red@0.8:boxborderw=5[bg6];
        [bg6]drawtext=text='${subscribeText}':fontsize=28:fontcolor=black:x=w-text_w-50:y=h-100:box=1:boxcolor=green@0.9:boxborderw=5[final]
      `,
      '-map', '[final]',
      '-c:v', 'libx264',
      '-t', duration.toString(),
      '-pix_fmt', 'yuv420p',
      '-r', fast ? '15' : '30',
      '-preset', fast ? 'ultrafast' : 'medium',
      '-y',
      outputPath
    ];

    console.log('🎬 Запуск FFmpeg:', 'ffmpeg', ffmpegArgs.join(' '));

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    ffmpegProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log('📹 FFmpeg:', data.toString().trim());
    });

    ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('⚠️ FFmpeg:', data.toString().trim());
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ FFmpeg завершен успешно');
        resolve({ stdout, stderr });
      } else {
        console.error('❌ FFmpeg завершен с ошибкой, код:', code);
        reject(new Error(`FFmpeg exited with code ${code}. Stderr: ${stderr}`));
      }
    });

    ffmpegProcess.on('error', (error) => {
      console.error('💥 Ошибка запуска FFmpeg:', error);
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
      fast = false
    } = req.body;

    if (!backgroundImage) {
      return res.status(400).json({ 
        error: 'Требуется backgroundImage URL'
      });
    }

    const timestamp = Date.now();
    const imageFilename = `bg_${timestamp}.jpg`;
    const videoFilename = `news_${timestamp}.mp4`;
    
    const imagePath = path.join(__dirname, 'temp', imageFilename);
    const outputPath = path.join(__dirname, 'outputs', videoFilename);

    console.log('⬇️ Скачиваем фоновое изображение...');
    await downloadImage(backgroundImage, imagePath);
    console.log('✅ Изображение скачано');

    console.log('🎥 Создаем видео через FFmpeg...');
    
    // Создаем видео через FFmpeg
    await createVideoWithFFmpeg(imagePath, outputPath, {
      title,
      duration,
      channelName,
      subscribeText,
      fast
    });
    
    console.log('✅ Видео создано успешно!');
    
    // Удаляем временное изображение
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
    
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
        size: `${fileSizeInMB} MB`,
        duration: duration,
        resolution: '1920x1080',
        title: title,
        method: 'FFmpeg (без editly)',
        created: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка при создании видео:', error);
    res.status(500).json({
      error: 'Ошибка при создании новостного видео',
      message: error.message
    });
  }
});

// Тест FFmpeg
app.post('/api/test', async (req, res) => {
  console.log('🧪 Тест FFmpeg');
  
  try {
    const testProcess = spawn('ffmpeg', ['-version'], {
      stdio: 'pipe'
    });
    
    let output = '';
    testProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    testProcess.on('close', (code) => {
      res.json({
        success: true,
        message: 'FFmpeg API работает!',
        ffmpegAvailable: code === 0,
        ffmpegVersion: output.split('\n')[0],
        method: 'Прямой FFmpeg без editly'
      });
    });
    
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Скачивание и стриминг (те же что были)
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(__dirname, 'outputs', filename);
  
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'Файл не найден' });
  }
  
  res.download(filepath, filename);
});

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
    message: '🎬 FFmpeg News Video API на Railway',
    version: '3.0.0',
    description: 'API для создания новостных видео через FFmpeg (без editly)',
    
    endpoints: {
      test: 'POST /api/test',
      createVideo: 'POST /api/create-news-video',
      download: 'GET /api/download/:filename',
      stream: 'GET /api/stream/:filename'
    },
    
    advantages: [
      '✅ Нет проблем с GL компиляцией',
      '✅ Только FFmpeg - легкая установка', 
      '✅ Быстрое создание видео',
      '✅ Стабильная работа в Docker'
    ],
    
    status: 'Готов к работе! 🚀'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🎬 ===== FFMPEG NEWS VIDEO API =====');
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('🎥 Метод: Прямой FFmpeg без editly');
  console.log('✅ Никаких проблем с GL!');
  console.log('=====================================');
});

export default app;
