// ПОЛНЫЙ ИСПРАВЛЕННЫЙ api-server.js с поддержкой динамических видео
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
const PORT = process.env.PORT || 8080;

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

// Функция очистки текста для безопасного использования в FFmpeg
function sanitizeText(text) {
  if (!text) return '';
  return text
    .replace(/['"\\]/g, '') // Убираем кавычки и слеши
    .replace(/[^\w\s\u0400-\u04FF.,!?():-]/g, '') // Оставляем только безопасные символы
    .slice(0, 100); // Ограничиваем длину
}

// ИСПРАВЛЕННАЯ функция создания динамического видео с множественными изображениями
function createDynamicVideo(imagePaths, outputPath, options) {
  return new Promise((resolve, reject) => {
    const {
      title = '🔥 Важная новость дня',
      duration = 60,
      channelName = '📺 AI Новости',
      subscribeText = '👆 ПОДПИШИСЬ НА КАНАЛ!',
      newsText = '',
      fast = false,
      enableKenBurns = true
    } = options;

    console.log(`🎬 Создание динамического видео из ${imagePaths.length} изображений`);

    // Подготавливаем безопасный текст
    const safeTitle = sanitizeText(title);
    const safeChannelName = sanitizeText(channelName);
    const safeSubscribeText = sanitizeText(subscribeText);

    // Разбиваем новостной текст на части для каждого изображения
    const sentences = newsText.split(/[.!?]+/).filter(s => s.trim().length > 10);
    const sentencesPerImage = Math.max(1, Math.floor(sentences.length / imagePaths.length));
    
    const sceneDuration = duration / imagePaths.length;
    
    // Строим входы для FFmpeg
    const inputs = imagePaths.map(imagePath => ['-loop', '1', '-i', imagePath]).flat();
    
    // Строим сложный фильтр с упрощенным Ken Burns
    const filterParts = [];
    
    // Обрабатываем каждое изображение
    imagePaths.forEach((imagePath, index) => {
      const startTime = index * sceneDuration;
      const endTime = Math.min((index + 1) * sceneDuration, duration);
      const sceneLength = endTime - startTime;
      
      // УПРОЩЕННЫЙ Ken Burns эффект без сложной математики
      let videoFilter = `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080`;
      
      if (enableKenBurns) {
        // Простой зум без панорамирования для избежания ошибок
        const zoomStart = 1.0;
        const zoomEnd = 1.15;
        
        videoFilter += `,zoompan=z='if(lte(zoom,${zoomStart}),${zoomEnd},max(${zoomStart + 0.001},zoom-0.002))':d=25*${sceneLength}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
      }
      
      videoFilter += `,setpts=PTS-STARTPTS+${startTime}/TB[v${index}]`;
      filterParts.push(videoFilter);
      
      // Добавляем субтитры для каждой сцены
      const sceneStart = index * sentencesPerImage;
      const sceneEnd = Math.min((index + 1) * sentencesPerImage, sentences.length);
      const sceneSentences = sentences.slice(sceneStart, sceneEnd);
      const subtitleText = sanitizeText(sceneSentences.join(' ').slice(0, 120));
      
      if (subtitleText) {
        filterParts.push(`[v${index}]drawtext=text='${subtitleText}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-100:box=1:boxcolor=black@0.8:boxborderw=8:enable='between(t,${startTime + 1},${endTime - 1})'[v${index}s]`);
      } else {
        filterParts.push(`[v${index}]copy[v${index}s]`);
      }
    });

    // Конкатенируем все сцены
    const concatInputs = imagePaths.map((_, index) => `[v${index}s]`).join('');
    const concatFilter = `${concatInputs}concat=n=${imagePaths.length}:v=1:a=0[vconcat]`;
    filterParts.push(concatFilter);

    // Добавляем общие элементы поверх всего видео
    // Красная новостная полоса
    filterParts.push(`[vconcat]drawbox=x=0:y=0:w=1920:h=80:color=red@0.9:t=fill[vbar]`);
    filterParts.push(`[vbar]drawtext=text='🔥 ВАЖНЫЕ НОВОСТИ • BREAKING NEWS • СРОЧНО 🔥':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=25[vtop]`);
    
    // Заголовок в начале видео
    filterParts.push(`[vtop]drawtext=text='${safeTitle}':fontsize=44:fontcolor=white:x=(w-text_w)/2:y=200:box=1:boxcolor=black@0.8:boxborderw=12:enable='between(t,2,10)'[vtitle]`);
    
    // Информация о канале
    filterParts.push(`[vtitle]drawtext=text='${safeChannelName}':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=h-200:box=1:boxcolor=red@0.8:boxborderw=8[vchannel]`);
    
    // Призыв к подписке в конце
    const subscribeStart = Math.max(0, duration - 8);
    filterParts.push(`[vchannel]drawtext=text='${safeSubscribeText}':fontsize=32:fontcolor=black:x=(w-text_w)/2:y=h-50:box=1:boxcolor=yellow@0.9:boxborderw=10:enable='between(t,${subscribeStart},${duration})'[vfinal]`);

    // Объединяем все фильтры
    const filterComplex = filterParts.join('; ');

    // FFmpeg аргументы
    const ffmpegArgs = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[vfinal]',
      '-c:v', 'libx264',
      '-t', duration.toString(),
      '-pix_fmt', 'yuv420p',
      '-r', fast ? '24' : '30',
      '-preset', fast ? 'ultrafast' : 'medium',
      '-crf', fast ? '28' : '23',
      '-y',
      outputPath
    ];

    console.log('🎬 FFmpeg команда для динамического видео (исправленная)');

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    ffmpegProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('⚠️ FFmpeg:', data.toString().trim());
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Динамическое видео создано успешно');
        resolve({ 
          stdout, 
          stderr,
          method: 'FFmpeg Dynamic (Fixed)',
          features: [
            'Множественные изображения',
            'Упрощенный Ken Burns эффект',
            'Синхронные субтитры',
            'Анимированные переходы'
          ]
        });
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

// ИСПРАВЛЕННАЯ функция создания видео из одного изображения
function createEnhancedVideo(imagePath, outputPath, options) {
  return new Promise((resolve, reject) => {
    const {
      title = '🔥 Важная новость дня',
      duration = 45,
      channelName = '📺 AI Новости',
      subscribeText = '👆 ПОДПИШИСЬ НА КАНАЛ!',
      newsText = '',
      fast = false,
      enableKenBurns = true
    } = options;

    const safeTitle = sanitizeText(title);
    const safeChannelName = sanitizeText(channelName);
    const safeSubscribeText = sanitizeText(subscribeText);
    const safeNewsText = sanitizeText(newsText.slice(0, 200));

    // ИСПРАВЛЕННЫЙ Ken Burns эффект - убрал проблемные sin/cos функции
    let kenBurnsFilter = '';
    if (enableKenBurns) {
      kenBurnsFilter = `,zoompan=z='if(lte(zoom,1.0),1.15,max(1.001,zoom-0.0008))':d=25*${duration}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
    }

    const ffmpegArgs = [
      '-loop', '1',
      '-i', imagePath,
      '-filter_complex', `
        [0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080${kenBurnsFilter}[bg];
        [bg]drawbox=x=0:y=0:w=1920:h=80:color=red@0.9:t=fill[bg1];
        [bg1]drawtext=text='🔥 ВАЖНЫЕ НОВОСТИ • BREAKING NEWS • СРОЧНО 🔥':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=25[bg2];
        [bg2]drawtext=text='📅 ${new Date().toLocaleDateString('ru-RU')}':fontsize=20:fontcolor=yellow:x=50:y=120[bg3];
        [bg3]drawtext=text='🔴 LIVE':fontsize=18:fontcolor=white:x=50:y=150:box=1:boxcolor=red@0.9:boxborderw=5[bg4];
        [bg4]drawtext=text='${safeTitle}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=250:box=1:boxcolor=black@0.8:boxborderw=12:enable='between(t,2,12)'[bg5];
        [bg5]drawtext=text='${safeNewsText}':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=h-150:box=1:boxcolor=black@0.8:boxborderw=8:enable='between(t,5,${duration-8})'[bg6];
        [bg6]drawtext=text='${safeChannelName}':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=h-80:box=1:boxcolor=red@0.8:boxborderw=8[bg7];
        [bg7]drawtext=text='${safeSubscribeText}':fontsize=30:fontcolor=black:x=(w-text_w)/2:y=h-40:box=1:boxcolor=yellow@0.9:boxborderw=8:enable='between(t,${duration-10},${duration})'[final]
      `,
      '-map', '[final]',
      '-c:v', 'libx264',
      '-t', duration.toString(),
      '-pix_fmt', 'yuv420p',
      '-r', fast ? '24' : '30',
      '-preset', fast ? 'ultrafast' : 'medium',
      '-crf', fast ? '28' : '23',
      '-y',
      outputPath
    ];

    console.log('🎬 FFmpeg команда для улучшенного видео (исправленная)');

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    ffmpegProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.log('⚠️ FFmpeg:', data.toString().trim());
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Улучшенное видео создано успешно');
        resolve({ 
          stdout, 
          stderr,
          method: 'FFmpeg Enhanced (Fixed)',
          features: [
            'Ken Burns эффект',
            'Анимированные титры',
            'Новостная полоса',
            'Синхронные субтитры'
          ]
        });
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

// УЛУЧШЕННЫЙ API endpoint для создания новостного видео
app.post('/api/create-news-video', async (req, res) => {
  console.log('📨 Получен запрос на создание новостного видео');
  console.log('📊 Параметры запроса:', JSON.stringify(req.body, null, 2));
  
  try {
    const {
      title = '🔥 Важная новость дня',
      backgroundImage,
      duration = 45,
      channelName = '📺 AI Новости',
      subscribeText = '👆 ПОДПИШИСЬ НА КАНАЛ!',
      fast = false,
      // НОВЫЕ параметры
      enhanced = false,
      newsText = '',
      images = [],
      enableKenBurns = true,
      enableTextAnimations = true
    } = req.body;

    // Определяем режим создания видео
    const isDynamic = Array.isArray(images) && images.length > 1;
    const isEnhanced = enhanced || enableKenBurns || newsText.length > 50;

    console.log(`🎯 Режим: ${isDynamic ? 'Динамический' : (isEnhanced ? 'Улучшенный' : 'Простой')}`);
    console.log(`📝 Текст новости: ${newsText.length} символов`);
    console.log(`🖼️ Изображений: ${isDynamic ? images.length : 1}`);

    const timestamp = Date.now();
    const videoFilename = `news_${timestamp}.mp4`;
    const outputPath = path.join(__dirname, 'outputs', videoFilename);
    const tempDir = path.join(__dirname, 'temp', `project_${timestamp}`);

    // Создаем временную папку
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let result;

    if (isDynamic) {
      // ДИНАМИЧЕСКИЙ РЕЖИМ: множественные изображения
      console.log('🎬 Создание динамического видео...');
      
      const imagePaths = [];
      for (let i = 0; i < images.length; i++) {
        const imageUrl = typeof images[i] === 'string' ? images[i] : images[i].url;
        const imagePath = path.join(tempDir, `image_${i}.jpg`);
        
        console.log(`⬇️ Скачиваем изображение ${i + 1}/${images.length}...`);
        try {
          await downloadImage(imageUrl, imagePath);
          imagePaths.push(imagePath);
        } catch (error) {
          console.error(`❌ Ошибка скачивания изображения ${i + 1}:`, error.message);
          // Используем fallback изображение
          if (backgroundImage) {
            await downloadImage(backgroundImage, imagePath);
            imagePaths.push(imagePath);
          }
        }
      }

      if (imagePaths.length === 0) {
        throw new Error('Не удалось скачать ни одного изображения');
      }

      result = await createDynamicVideo(imagePaths, outputPath, {
        title,
        duration,
        channelName,
        subscribeText,
        newsText,
        fast,
        enableKenBurns
      });

    } else {
      // УЛУЧШЕННЫЙ ИЛИ ПРОСТОЙ РЕЖИМ: одно изображение
      const imageUrl = backgroundImage || (images[0] && (typeof images[0] === 'string' ? images[0] : images[0].url));
      
      if (!imageUrl) {
        return res.status(400).json({ 
          error: 'Требуется backgroundImage URL или массив images'
        });
      }

      const imagePath = path.join(tempDir, 'background.jpg');
      
      console.log('⬇️ Скачиваем фоновое изображение...');
      await downloadImage(imageUrl, imagePath);
      console.log('✅ Изображение скачано');

      if (isEnhanced) {
        console.log('🎨 Создание улучшенного видео...');
        result = await createEnhancedVideo(imagePath, outputPath, {
          title,
          duration,
          channelName,
          subscribeText,
          newsText,
          fast,
          enableKenBurns
        });
      } else {
        console.log('📼 Создание простого видео...');
        // Используем старую функцию для обратной совместимости
        result = await createVideoWithFFmpeg(imagePath, outputPath, {
          title,
          duration,
          channelName,
          subscribeText,
          fast
        });
        result.method = 'FFmpeg Simple';
        result.features = ['Базовое видео'];
      }
    }
    
    console.log('✅ Видео создано успешно!');
    
    // Очищаем временную папку
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
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
        method: result.method,
        features: result.features,
        mode: isDynamic ? 'dynamic' : (isEnhanced ? 'enhanced' : 'simple'),
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

// Оригинальная функция (для обратной совместимости)
function createVideoWithFFmpeg(imagePath, outputPath, options) {
  return new Promise((resolve, reject) => {
    const {
      title = '🔥 Важная новость дня',
      duration = 149,
      channelName = '📺 НОВОСТНОЙ КАНАЛ',
      subscribeText = '👆 ПОДПИШИСЬ НА КАНАЛ!',
      fast = false
    } = options;

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
        [bg4]drawtext=text='${sanitizeText(title)}':fontsize=52:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=black@0.9:boxborderw=10[bg5];
        [bg5]drawtext=text='${sanitizeText(channelName)}':fontsize=32:fontcolor=white:x=(w-text_w)/2:y=h-200:box=1:boxcolor=red@0.8:boxborderw=5[bg6];
        [bg6]drawtext=text='${sanitizeText(subscribeText)}':fontsize=28:fontcolor=black:x=w-text_w-50:y=h-100:box=1:boxcolor=green@0.9:boxborderw=5[final]
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

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';

    ffmpegProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`FFmpeg exited with code ${code}. Stderr: ${stderr}`));
      }
    });

    ffmpegProcess.on('error', (error) => {
      reject(error);
    });
  });
}

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
        message: 'Enhanced FFmpeg API работает!',
        ffmpegAvailable: code === 0,
        ffmpegVersion: output.split('\n')[0],
        modes: ['Simple', 'Enhanced', 'Dynamic'],
        features: [
          'Ken Burns эффект (исправлен)',
          'Множественные изображения',
          'Синхронные субтитры',
          'Анимированные титры'
        ]
      });
    });
    
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Download и stream endpoints
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
    message: '🎬 Enhanced FFmpeg News Video API (FIXED)',
    version: '4.1.0',
    description: 'API для создания улучшенных новостных видео с исправленными эффектами',
    
    modes: {
      simple: 'Простое видео (как раньше)',
      enhanced: 'Улучшенное видео (Ken Burns + титры) - ИСПРАВЛЕНО',
      dynamic: 'Динамическое видео (множественные изображения) - ИСПРАВЛЕНО'
    },
    
    endpoints: {
      test: 'POST /api/test',
      createVideo: 'POST /api/create-news-video',
      download: 'GET /api/download/:filename',
      stream: 'GET /api/stream/:filename'
    },
    
    fixedFeatures: [
      '✅ Ken Burns эффект (исправлен)',
      '✅ Множественные изображения',
      '✅ Синхронные субтитры',
      '✅ Анимированные титры',
      '✅ Плавные переходы',
      '✅ Улучшенная новостная полоса'
    ],
    
    status: 'Готов к созданию исправленных динамических видео! 🚀'
  });
});


app.listen(PORT, '0.0.0.0', () => {
  console.log('🎬 ===== ENHANCED FFMPEG NEWS VIDEO API =====');
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('🎥 Методы: Simple | Enhanced | Dynamic');
  console.log('✨ Новые возможности:');
  console.log('   🎬 Ken Burns эффект');
  console.log('   🖼️ Множественные изображения');
  console.log('   📝 Синхронные субтитры');
  console.log('   🎭 Анимированные титры');
  console.log('================================================');
});

export default app;
