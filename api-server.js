// ИДЕАЛЬНАЯ СИСТЕМА НОВОСТНЫХ ВИДЕО ИЗ КАРТИНОК
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

// УЛУЧШЕННАЯ функция скачивания с детальным логированием
function downloadImage(url, filepath, index = 0) {
  return new Promise((resolve, reject) => {
    console.log(`📥 [${index + 1}] Начинаем загрузку: ${url}`);
    
    // Создаем временный файл
    const tempPath = filepath + '.tmp';
    const file = fs.createWriteStream(tempPath);
    const request = url.startsWith('https:') ? https : http;
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    };
    
    const req = request.get(url, options, (response) => {
      console.log(`📊 [${index + 1}] HTTP статус: ${response.statusCode}`);
      console.log(`📊 [${index + 1}] Заголовки:`, response.headers);
      
      // Обработка редиректов
      if (response.statusCode === 301 || response.statusCode === 302) {
        const newUrl = response.headers.location;
        console.log(`🔄 [${index + 1}] Редирект на: ${newUrl}`);
        file.close();
        fs.unlink(tempPath, () => {});
        return downloadImage(newUrl, filepath, index)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(tempPath, () => {});
        reject(new Error(`HTTP Error ${response.statusCode} for image ${index + 1}: ${url}`));
        return;
      }
      
      // Проверяем тип контента
      const contentType = response.headers['content-type'] || '';
      console.log(`📁 [${index + 1}] Тип контента: ${contentType}`);
      
      if (!contentType.startsWith('image/')) {
        file.close();
        fs.unlink(tempPath, () => {});
        reject(new Error(`Not an image (${contentType}) for image ${index + 1}: ${url}`));
        return;
      }
      
      console.log(`💾 [${index + 1}] Начинаем сохранение...`);
      response.pipe(file);
      
      let downloadedBytes = 0;
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (downloadedBytes % 50000 === 0) { // Логируем каждые 50KB
          console.log(`📈 [${index + 1}] Загружено: ${(downloadedBytes / 1024).toFixed(1)} KB`);
        }
      });
      
      file.on('finish', () => {
        file.close();
        console.log(`✅ [${index + 1}] Загрузка завершена: ${(downloadedBytes / 1024).toFixed(1)} KB`);
        
        // Проверяем размер файла
        if (downloadedBytes < 1000) {
          fs.unlink(tempPath, () => {});
          reject(new Error(`File too small (${downloadedBytes} bytes) for image ${index + 1}`));
          return;
        }
        
        // Переименовываем из временного в финальный файл
        fs.rename(tempPath, filepath, (err) => {
          if (err) {
            console.error(`❌ [${index + 1}] Ошибка переименования:`, err);
            fs.unlink(tempPath, () => {});
            reject(err);
          } else {
            console.log(`✅ [${index + 1}] Файл сохранен: ${filepath}`);
            resolve();
          }
        });
      });
      
      file.on('error', (err) => {
        console.error(`❌ [${index + 1}] Ошибка записи:`, err);
        fs.unlink(tempPath, () => {});
        reject(err);
      });
    });
    
    req.on('error', (err) => {
      console.error(`❌ [${index + 1}] Ошибка запроса:`, err);
      file.close();
      fs.unlink(tempPath, () => {});
      reject(err);
    });
    
    // Увеличиваем таймаут
    req.setTimeout(45000, () => {
      console.error(`⏰ [${index + 1}] Таймаут загрузки: ${url}`);
      req.destroy();
      file.close();
      fs.unlink(tempPath, () => {});
      reject(new Error(`Download timeout for image ${index + 1}: ${url}`));
    });
  });
}

// УЛУЧШЕННАЯ функция разделения текста
function smartTextSplit(text, numParts) {
  if (!text || text.length < 20) {
    // Если текста мало, дублируем
    const parts = [];
    for (let i = 0; i < numParts; i++) {
      parts.push(text || `Часть ${i + 1} новости`);
    }
    return parts;
  }
  
  // Сначала пробуем разделить по предложениям
  let sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  
  if (sentences.length >= numParts) {
    // Достаточно предложений - группируем
    const parts = [];
    const sentencesPerPart = Math.ceil(sentences.length / numParts);
    
    for (let i = 0; i < numParts; i++) {
      const start = i * sentencesPerPart;
      const end = Math.min((i + 1) * sentencesPerPart, sentences.length);
      const partText = sentences.slice(start, end).join('. ').trim();
      parts.push(partText + (partText.endsWith('.') ? '' : '.'));
    }
    
    return parts;
  }
  
  // Мало предложений - делим по длине
  const parts = [];
  const charsPerPart = Math.ceil(text.length / numParts);
  
  for (let i = 0; i < numParts; i++) {
    let start = i * charsPerPart;
    let end = Math.min((i + 1) * charsPerPart, text.length);
    
    // Корректируем границы по словам
    if (i > 0 && start < text.length) {
      while (start > 0 && text[start] !== ' ') start--;
      if (text[start] === ' ') start++;
    }
    
    if (end < text.length) {
      while (end < text.length && text[end] !== ' ') end++;
    }
    
    const partText = text.substring(start, end).trim();
    if (partText) {
      parts.push(partText);
    }
  }
  
  // Дополняем до нужного количества частей
  while (parts.length < numParts) {
    parts.push(parts[parts.length - 1] || 'Продолжение новости...');
  }
  
  return parts.slice(0, numParts);
}

// УЛУЧШЕННАЯ функция создания динамического видео
function createPerfectDynamicVideo(imagePaths, outputPath, options) {
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

    console.log(`🎬 Создание ИДЕАЛЬНОГО динамического видео из ${imagePaths.length} изображений`);

    // Проверяем все изображения
    for (let i = 0; i < imagePaths.length; i++) {
      if (!fs.existsSync(imagePaths[i])) {
        console.error(`❌ Изображение ${i + 1} не найдено: ${imagePaths[i]}`);
        return reject(new Error(`Изображение ${i + 1} не найдено`));
      }
      
      const stats = fs.statSync(imagePaths[i]);
      console.log(`✅ Изображение ${i + 1}: ${(stats.size / 1024).toFixed(1)} KB - ${imagePaths[i]}`);
    }

    // Подготавливаем безопасный текст
    const safeTitle = sanitizeText(title);
    const safeChannelName = sanitizeText(channelName);
    const safeSubscribeText = sanitizeText(subscribeText);

    // УМНОЕ разделение текста
    const textParts = smartTextSplit(newsText, imagePaths.length);
    console.log(`📝 Разделили текст на ${textParts.length} частей:`);
    textParts.forEach((part, i) => {
      console.log(`   ${i + 1}. "${part.substring(0, 50)}..."`);
    });
    
    const sceneDuration = duration / imagePaths.length;
    console.log(`⏱️ Длительность каждой сцены: ${sceneDuration.toFixed(1)} секунд`);
    
    // Строим входы для FFmpeg
    const inputs = imagePaths.map(imagePath => ['-loop', '1', '-i', imagePath]).flat();
    
    // Строим сложный фильтр с МОЩНЫМИ эффектами
    const filterParts = [];
    
    // Обрабатываем каждое изображение
    imagePaths.forEach((imagePath, index) => {
      const startTime = index * sceneDuration;
      const endTime = Math.min((index + 1) * sceneDuration, duration);
      const sceneLength = endTime - startTime;
      
      console.log(`🎬 Сцена ${index + 1}: ${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s (${sceneLength.toFixed(1)}s)`);
      
      // МОЩНЫЙ Ken Burns эффект с разными типами движения
      let videoFilter = `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080`;
      
      if (enableKenBurns) {
        const effects = [
          // Приближение с панорамой вправо
          `zoompan=z='min(1.5,1.0+0.002*t)':d=25*${sceneLength}:x='iw/2-(iw/zoom/2)+t*30':y='ih/2-(ih/zoom/2)':s=1920x1080`,
          
          // Отдаление с панорамой влево  
          `zoompan=z='max(1.0,1.5-0.002*t)':d=25*${sceneLength}:x='iw/2-(iw/zoom/2)-t*20':y='ih/2-(ih/zoom/2)':s=1920x1080`,
          
          // Диагональное движение с зумом
          `zoompan=z='min(1.4,1.0+0.0015*t)':d=25*${sceneLength}:x='iw/2-(iw/zoom/2)+t*25':y='ih/2-(ih/zoom/2)+t*15':s=1920x1080`,
          
          // Центральное приближение
          `zoompan=z='min(1.6,1.0+0.0025*t)':d=25*${sceneLength}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080`
        ];
        
        videoFilter += `,` + effects[index % effects.length];
      }
      
      videoFilter += `,setpts=PTS-STARTPTS+${startTime}/TB[v${index}]`;
      filterParts.push(videoFilter);
      
      // Добавляем ИНДИВИДУАЛЬНЫЕ субтитры для каждой сцены
      const subtitleText = sanitizeText(textParts[index] || `Часть ${index + 1} новости`);
      console.log(`📝 Субтитры для сцены ${index + 1}: "${subtitleText.substring(0, 50)}..."`);
      
      // Субтитры с анимацией появления
      const subtitleStart = startTime + 1;
      const subtitleEnd = endTime - 0.5;
      
      if (subtitleText && subtitleText.length > 5) {
        filterParts.push(`[v${index}]drawtext=text='${subtitleText}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=h-140:box=1:boxcolor=black@0.9:boxborderw=12:enable='between(t,${subtitleStart},${subtitleEnd})'[v${index}s]`);
      } else {
        filterParts.push(`[v${index}]copy[v${index}s]`);
      }
    });

    // Конкатенируем все сцены
    const concatInputs = imagePaths.map((_, index) => `[v${index}s]`).join('');
    const concatFilter = `${concatInputs}concat=n=${imagePaths.length}:v=1:a=0[vconcat]`;
    filterParts.push(concatFilter);

    // Добавляем ЯРКИЕ общие элементы
    // Анимированная красная полоса
    filterParts.push(`[vconcat]drawbox=x=0:y=0:w=1920:h=100:color=red@0.95:t=fill[vbar]`);
    filterParts.push(`[vbar]drawtext=text='🔥 ВАЖНЫЕ НОВОСТИ • BREAKING NEWS • СРОЧНО 🔥':fontsize=30:fontcolor=white:x=(w-text_w)/2:y=30[vtop]`);
    
    // Заголовок с яркой анимацией
    filterParts.push(`[vtop]drawtext=text='${safeTitle}':fontsize=56:fontcolor=yellow:x=(w-text_w)/2:y=350:box=1:boxcolor=black@0.9:boxborderw=15:enable='between(t,1,10)'[vtitle]`);
    
    // Информация о канале - всегда видна
    filterParts.push(`[vtitle]drawtext=text='${safeChannelName}':fontsize=26:fontcolor=white:x=50:y=h-60:box=1:boxcolor=red@0.9:boxborderw=8[vchannel]`);
    
    // Прогресс-бар сцен
    imagePaths.forEach((_, index) => {
      const startTime = index * sceneDuration;
      const endTime = Math.min((index + 1) * sceneDuration, duration);
      const progress = `${index + 1}/${imagePaths.length}`;
      filterParts.push(`[vchannel]drawtext=text='${progress}':fontsize=24:fontcolor=yellow:x=w-120:y=130:box=1:boxcolor=black@0.8:boxborderw=6:enable='between(t,${startTime + 1},${endTime - 1})'[vchannel]`);
    });
    
    // Большой призыв к подписке в конце
    const subscribeStart = Math.max(0, duration - 8);
    filterParts.push(`[vchannel]drawtext=text='${safeSubscribeText}':fontsize=40:fontcolor=black:x=(w-text_w)/2:y=h-80:box=1:boxcolor=yellow@0.95:boxborderw=15:enable='between(t,${subscribeStart},${duration})'[vfinal]`);

    // Объединяем все фильтры
    const filterComplex = filterParts.join('; ');
    
    console.log(`🎬 Создано ${filterParts.length} фильтров`);

    // FFmpeg аргументы с оптимизацией
    const ffmpegArgs = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[vfinal]',
      '-c:v', 'libx264',
      '-t', duration.toString(),
      '-pix_fmt', 'yuv420p',
      '-r', fast ? '25' : '30',
      '-preset', fast ? 'ultrafast' : 'fast',
      '-crf', fast ? '25' : '18', // Лучшее качество
      '-maxrate', '8M',
      '-bufsize', '16M',
      '-y',
      outputPath
    ];

    console.log('🎬 Запуск FFmpeg для создания ИДЕАЛЬНОГО видео');

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
      const line = data.toString().trim();
      if (line.includes('frame=') || line.includes('time=')) {
        // Показываем только важный прогресс
        const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
          const currentSeconds = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
          const progress = ((currentSeconds / duration) * 100).toFixed(1);
          console.log(`⚡ Прогресс: ${progress}% (${currentSeconds}s/${duration}s)`);
        }
      }
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ ИДЕАЛЬНОЕ динамическое видео создано успешно!');
        resolve({ 
          stdout, 
          stderr,
          method: 'Perfect Dynamic Video',
          features: [
            'Множественные изображения ✓',
            'Мощный Ken Burns эффект ✓',
            'Индивидуальные субтитры ✓',
            'Умное разделение текста ✓',
            'Прогресс-бар сцен ✓',
            'Высокое качество видео ✓'
          ]
        });
      } else {
        console.error('❌ FFmpeg завершен с ошибкой, код:', code);
        console.error('❌ Последние строки stderr:', stderr.split('\n').slice(-5).join('\n'));
        reject(new Error(`FFmpeg exited with code ${code}. Last stderr: ${stderr.slice(-300)}`));
      }
    });

    ffmpegProcess.on('error', (error) => {
      console.error('💥 Ошибка запуска FFmpeg:', error);
      reject(error);
    });
  });
}

// Функция очистки текста
function sanitizeText(text) {
  if (!text) return '';
  return text
    .replace(/['"\\]/g, '')
    .replace(/[^\w\s\u0400-\u04FF.,!?():-]/g, '')
    .slice(0, 150); // Увеличили лимит
}

// ГЛАВНЫЙ API ENDPOINT
app.post('/api/create-news-video', async (req, res) => {
  console.log('📨 Получен запрос на создание ИДЕАЛЬНОГО новостного видео');
  console.log('📊 Параметры запроса:', JSON.stringify(req.body, null, 2));
  
  try {
    const {
      title = '🔥 Важная новость дня',
      backgroundImage,
      duration = 45,
      channelName = '📺 AI Новости',
      subscribeText = '👆 ПОДПИШИСЬ НА КАНАЛ!',
      fast = false,
      enhanced = true, // По умолчанию включен
      newsText = '',
      images = [],
      enableKenBurns = true
    } = req.body;

    const timestamp = Date.now();
    const videoFilename = `perfect_news_${timestamp}.mp4`;
    const outputPath = path.join(__dirname, 'outputs', videoFilename);
    const tempDir = path.join(__dirname, 'temp', `perfect_${timestamp}`);

    // Создаем временную папку
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Определяем источники изображений
    const imageUrls = [];
    
    if (Array.isArray(images) && images.length > 0) {
      // Используем массив изображений
      images.forEach((img, i) => {
        const url = typeof img === 'string' ? img : img.url;
        if (url) {
          imageUrls.push(url);
          console.log(`🖼️ Изображение ${i + 1}: ${url}`);
        }
      });
    }
    
    if (backgroundImage && !imageUrls.includes(backgroundImage)) {
      imageUrls.unshift(backgroundImage);
      console.log(`🖼️ Фоновое изображение: ${backgroundImage}`);
    }

    // Минимум одно изображение обязательно
    if (imageUrls.length === 0) {
      return res.status(400).json({ 
        error: 'Требуется хотя бы одно изображение (backgroundImage или images)'
      });
    }

    // Ограничиваем до 4 изображений для стабильности
    const limitedUrls = imageUrls.slice(0, 4);
    console.log(`📊 Будем использовать ${limitedUrls.length} изображений`);

    // ПОСЛЕДОВАТЕЛЬНОЕ скачивание изображений с детальным логированием
    const imagePaths = [];
    
    for (let i = 0; i < limitedUrls.length; i++) {
      const imageUrl = limitedUrls[i];
      const imagePath = path.join(tempDir, `image_${i}.jpg`);
      
      console.log(`\n⬇️ ===== СКАЧИВАНИЕ ИЗОБРАЖЕНИЯ ${i + 1}/${limitedUrls.length} =====`);
      console.log(`🔗 URL: ${imageUrl}`);
      console.log(`📁 Путь: ${imagePath}`);
      
      try {
        await downloadImage(imageUrl, imagePath, i);
        
        // Дополнительная проверка
        if (fs.existsSync(imagePath)) {
          const stats = fs.statSync(imagePath);
          if (stats.size > 1000) {
            imagePaths.push(imagePath);
            console.log(`✅ Изображение ${i + 1} успешно загружено и проверено`);
          } else {
            console.error(`❌ Изображение ${i + 1} слишком маленькое: ${stats.size} байт`);
          }
        } else {
          console.error(`❌ Файл изображения ${i + 1} не создался`);
        }
        
      } catch (error) {
        console.error(`❌ Ошибка загрузки изображения ${i + 1}:`, error.message);
        
        // Для первого изображения - критичная ошибка
        if (i === 0) {
          console.error(`💥 Первое изображение обязательно - прерываем`);
          throw error;
        }
      }
      
      console.log(`===== КОНЕЦ СКАЧИВАНИЯ ${i + 1} =====\n`);
    }

    console.log(`📊 ИТОГО загружено: ${imagePaths.length} из ${limitedUrls.length} изображений`);

    if (imagePaths.length === 0) {
      throw new Error('Не удалось загрузить ни одного изображения');
    }

    // Создаем видео
    const result = await createPerfectDynamicVideo(imagePaths, outputPath, {
      title,
      duration,
      channelName,
      subscribeText,
      newsText,
      fast,
      enableKenBurns
    });
    
    console.log('✅ ИДЕАЛЬНОЕ видео создано успешно!');
    
    // Очищаем временную папку
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    
    // Проверяем результат
    if (!fs.existsSync(outputPath)) {
      throw new Error('Видео файл не был создан');
    }
    
    const stats = fs.statSync(outputPath);
    const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    console.log(`📊 Размер файла: ${fileSizeInMB} MB`);
    
    res.json({
      success: true,
      message: 'ИДЕАЛЬНОЕ новостное видео создано! 🎬✨',
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
        imagesUsed: imagePaths.length,
        imagesRequested: limitedUrls.length,
        mode: imagePaths.length > 1 ? 'dynamic' : 'enhanced',
        created: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка при создании ИДЕАЛЬНОГО видео:', error);
    res.status(500).json({
      error: 'Ошибка при создании идеального новостного видео',
      message: error.message
    });
  }
});

// Остальные endpoints (download, stream, test)
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

// Тест
app.post('/api/test', async (req, res) => {
  console.log('🧪 Тест ИДЕАЛЬНОЙ системы');
  
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
        message: 'ИДЕАЛЬНАЯ система новостных видео готова!',
        ffmpegAvailable: code === 0,
        ffmpegVersion: output.split('\n')[0],
        features: [
          '✅ Детальное логирование загрузки',
          '✅ Умное разделение текста',
          '✅ Мощные Ken Burns эффекты',
          '✅ Индивидуальные субтитры',
          '✅ Прогресс-бар сцен',
          '✅ Высокое качество видео',
          '✅ Надежная обработка ошибок'
        ],
        limits: {
          maxImages: 4,
          maxDuration: 60,
          imageTimeout: 45
        }
      });
    });
    
  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Главная страница
app.get('/', (req, res) => {
  res.json({
    message: '🎬 PERFECT Image-Based News Video API',
    version: '6.0.0',
    description: 'Идеальная система создания новостных видео из изображений',
    
    features: {
      '📥 Загрузка': 'Детальное логирование + проверка файлов',
      '📝 Текст': 'Умное разделение по сценам',
      '🎬 Эффекты': 'Мощный Ken Burns с 4 типами движения',
      '📊 Прогресс': 'Счетчик сцен и прогресс-бар',
      '🎨 Качество': 'CRF 18 для максимального качества'
    },
    
    endpoints: {
      createVideo: 'POST /api/create-news-video',
      test: 'POST /api/test',
      download: 'GET /api/download/:filename',
      stream: 'GET /api/stream/:filename'
    },
    
    improvements: [
      '🔧 Исправлено скачивание изображений',
      '📝 Улучшено разделение субтитров',
      '🎬 Усилен Ken Burns эффект',
      '📊 Добавлен прогресс-бар',
      '🎯 Повышено качество видео'
    ],
    
    status: 'Готова к созданию ИДЕАЛЬНЫХ видео! 🚀✨'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🎬 ===== PERFECT IMAGE-BASED NEWS VIDEO API =====');
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('✨ Режим: ИДЕАЛЬНЫЕ видео из изображений');
  console.log('🎯 Улучшения:');
  console.log('   📥 Детальное логирование загрузки');
  console.log('   📝 Умное разделение текста на сцены');
  console.log('   🎬 Мощные Ken Burns эффекты (4 типа)');
  console.log('   📊 Прогресс-бар и счетчики');
  console.log('   🎨 Максимальное качество (CRF 18)');
  console.log('================================================');
});

export default app;
