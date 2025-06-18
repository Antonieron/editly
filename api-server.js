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

// ИСПРАВЛЕННАЯ функция очистки текста для FFmpeg
function sanitizeText(text) {
  if (!text) return '';
  
  return text
    .replace(/['"\\]/g, '') // Убираем кавычки и слеши
    .replace(/:/g, ' - ') // Двоеточия заменяем на тире (КРИТИЧНО для FFmpeg!)
    .replace(/=/g, ' равно ') // Знаки равенства
    .replace(/\[/g, '(') // Квадратные скобки
    .replace(/\]/g, ')')
    .replace(/\n/g, ' ') // Переносы строк
    .replace(/\r/g, ' ') 
    .replace(/\t/g, ' ') // Табуляции
    .replace(/[^\w\s\u0400-\u04FF.,!?()\-]/g, '') // Только безопасные символы
    .replace(/\s+/g, ' ') // Множественные пробелы в один
    .trim()
    .slice(0, 100); // Ограничиваем длину
}

// ИСПРАВЛЕННАЯ функция умного разделения текста
function smartTextSplit(text, numParts) {
  if (!text || text.length < 20) {
    const parts = [];
    for (let i = 0; i < numParts; i++) {
      parts.push(`Часть ${i + 1} новости`);
    }
    return parts;
  }
  
  // Предварительно очищаем весь текст
  const cleanText = text
    .replace(/['"\\:=\[\]]/g, ' ') // Убираем проблемные символы
    .replace(/\s+/g, ' ')
    .trim();
  
  // Разделяем по предложениям
  let sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 15);
  
  if (sentences.length >= numParts) {
    const parts = [];
    const sentencesPerPart = Math.ceil(sentences.length / numParts);
    
    for (let i = 0; i < numParts; i++) {
      const start = i * sentencesPerPart;
      const end = Math.min((i + 1) * sentencesPerPart, sentences.length);
      let partText = sentences.slice(start, end).join('. ').trim();
      
      if (partText) {
        if (!partText.endsWith('.')) partText += '.';
        parts.push(partText.slice(0, 80)); // Короче для надежности
      }
    }
    
    // Дополняем если нужно
    while (parts.length < numParts) {
      parts.push(`Продолжение новости ${parts.length + 1}`);
    }
    
    return parts;
  }
  
  // Мало предложений - делим по длине
  const parts = [];
  const charsPerPart = Math.ceil(cleanText.length / numParts);
  
  for (let i = 0; i < numParts; i++) {
    let start = i * charsPerPart;
    let end = Math.min((i + 1) * charsPerPart, cleanText.length);
    
    // Корректируем по словам
    if (i > 0 && start < cleanText.length) {
      while (start > 0 && cleanText[start] !== ' ') start--;
      if (cleanText[start] === ' ') start++;
    }
    
    if (end < cleanText.length) {
      while (end < cleanText.length && cleanText[end] !== ' ') end++;
    }
    
    const partText = cleanText.substring(start, end).trim().slice(0, 80);
    if (partText) {
      parts.push(partText);
    }
  }
  
  while (parts.length < numParts) {
    parts.push(`Часть ${parts.length + 1} новости`);
  }
  
  return parts.slice(0, numParts);
}

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

// ИСПРАВЛЕННАЯ функция создания динамического видео
function createPerfectDynamicVideo(imagePaths, outputPath, options) {
  return new Promise((resolve, reject) => {
    const {
      title = 'Важная новость дня',
      duration = 60,
      channelName = 'AI Новости',
      subscribeText = 'ПОДПИШИСЬ НА КАНАЛ',
      newsText = '',
      fast = false,
      enableKenBurns = true
    } = options;

    console.log(`🎬 Создание ИСПРАВЛЕННОГО динамического видео из ${imagePaths.length} изображений`);

    // Проверяем все изображения
    for (let i = 0; i < imagePaths.length; i++) {
      if (!fs.existsSync(imagePaths[i])) {
        console.error(`❌ Изображение ${i + 1} не найдено: ${imagePaths[i]}`);
        return reject(new Error(`Изображение ${i + 1} не найдено`));
      }
      
      const stats = fs.statSync(imagePaths[i]);
      console.log(`✅ Изображение ${i + 1}: ${(stats.size / 1024).toFixed(1)} KB`);
    }

    // БЕЗОПАСНАЯ очистка всех текстов
    const safeTitle = sanitizeText(title);
    const safeChannelName = sanitizeText(channelName);
    const safeSubscribeText = sanitizeText(subscribeText);

    console.log(`📝 Безопасные тексты:`);
    console.log(`   Заголовок: "${safeTitle}"`);
    console.log(`   Канал: "${safeChannelName}"`);
    console.log(`   Подписка: "${safeSubscribeText}"`);

    // БЕЗОПАСНОЕ разделение текста
    const textParts = smartTextSplit(newsText, imagePaths.length);
    console.log(`📝 Разделили текст на ${textParts.length} частей:`);
    textParts.forEach((part, i) => {
      const safePart = sanitizeText(part);
      console.log(`   ${i + 1}. "${safePart}"`);
    });
    
    const sceneDuration = duration / imagePaths.length;
    console.log(`⏱️ Длительность каждой сцены: ${sceneDuration.toFixed(1)} секунд`);
    
    // Строим входы для FFmpeg
    const inputs = imagePaths.map(imagePath => ['-loop', '1', '-i', imagePath]).flat();
    
    // Строим БЕЗОПАСНЫЙ сложный фильтр
    const filterParts = [];
    
    // Обрабатываем каждое изображение
    imagePaths.forEach((imagePath, index) => {
      const startTime = index * sceneDuration;
      const endTime = Math.min((index + 1) * sceneDuration, duration);
      const sceneLength = endTime - startTime;
      
      console.log(`🎬 Сцена ${index + 1}: ${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s`);
      
      // УПРОЩЕННЫЙ Ken Burns эффект (убираем сложную математику)
      let videoFilter = `[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080`;
      
      if (enableKenBurns) {
        // Простые, надежные эффекты
        if (index % 2 === 0) {
          // Приближение
          videoFilter += `,zoompan=z='min(1.3,1.0+0.001*t)':d=25*${sceneLength}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
        } else {
          // Отдаление
          videoFilter += `,zoompan=z='max(1.0,1.3-0.001*t)':d=25*${sceneLength}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080`;
        }
      }
      
      videoFilter += `,setpts=PTS-STARTPTS+${startTime}/TB[v${index}]`;
      filterParts.push(videoFilter);
      
      // БЕЗОПАСНЫЕ субтитры для каждой сцены
      const subtitleText = sanitizeText(textParts[index] || `Часть ${index + 1}`);
      console.log(`📝 Безопасные субтитры ${index + 1}: "${subtitleText}"`);
      
      const subtitleStart = startTime + 1;
      const subtitleEnd = endTime - 0.5;
      
      if (subtitleText && subtitleText.length > 3) {
        // ПРОСТОЙ drawtext без сложных параметров
        filterParts.push(`[v${index}]drawtext=text='${subtitleText}':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=h-120:box=1:boxcolor=black@0.8:boxborderw=8:enable='between(t,${subtitleStart.toFixed(1)},${subtitleEnd.toFixed(1)})'[v${index}s]`);
      } else {
        filterParts.push(`[v${index}]copy[v${index}s]`);
      }
    });

    // Конкатенируем все сцены
    const concatInputs = imagePaths.map((_, index) => `[v${index}s]`).join('');
    const concatFilter = `${concatInputs}concat=n=${imagePaths.length}:v=1:a=0[vconcat]`;
    filterParts.push(concatFilter);

    // ПРОСТЫЕ общие элементы без сложных текстов
    filterParts.push(`[vconcat]drawbox=x=0:y=0:w=1920:h=80:color=red@0.9:t=fill[vbar]`);
    filterParts.push(`[vbar]drawtext=text='ВАЖНЫЕ НОВОСТИ':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=25[vtop]`);
    
    if (safeTitle.length > 0) {
      filterParts.push(`[vtop]drawtext=text='${safeTitle}':fontsize=48:fontcolor=yellow:x=(w-text_w)/2:y=300:box=1:boxcolor=black@0.8:boxborderw=10:enable='between(t,1,8)'[vtitle]`);
    } else {
      filterParts.push(`[vtop]copy[vtitle]`);
    }
    
    if (safeChannelName.length > 0) {
      filterParts.push(`[vtitle]drawtext=text='${safeChannelName}':fontsize=24:fontcolor=white:x=50:y=h-50:box=1:boxcolor=red@0.8:boxborderw=6[vchannel]`);
    } else {
      filterParts.push(`[vtitle]copy[vchannel]`);
    }
    
    if (safeSubscribeText.length > 0) {
      const subscribeStart = Math.max(0, duration - 6);
      filterParts.push(`[vchannel]drawtext=text='${safeSubscribeText}':fontsize=32:fontcolor=black:x=(w-text_w)/2:y=h-60:box=1:boxcolor=yellow@0.9:boxborderw=8:enable='between(t,${subscribeStart.toFixed(1)},${duration})'[vfinal]`);
    } else {
      filterParts.push(`[vchannel]copy[vfinal]`);
    }

    // Объединяем все фильтры
    const filterComplex = filterParts.join('; ');
    
    console.log(`🎬 Создано ${filterParts.length} безопасных фильтров`);
    console.log(`🔧 Длина filter_complex: ${filterComplex.length} символов`);

    // FFmpeg аргументы
    const ffmpegArgs = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[vfinal]',
      '-c:v', 'libx264',
      '-t', duration.toString(),
      '-pix_fmt', 'yuv420p',
      '-r', fast ? '25' : '30',
      '-preset', fast ? 'ultrafast' : 'fast',
      '-crf', fast ? '23' : '20',
      '-y',
      outputPath
    ];

    console.log('🎬 Запуск FFmpeg для ИСПРАВЛЕННОГО видео');

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
        const timeMatch = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch) {
          const currentSeconds = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
          const progress = ((currentSeconds / duration) * 100).toFixed(1);
          console.log(`⚡ Прогресс: ${progress}%`);
        }
      }
    });

    ffmpegProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ ИСПРАВЛЕННОЕ динамическое видео создано успешно!');
        resolve({ 
          stdout, 
          stderr,
          method: 'Fixed Dynamic Video',
          features: [
            'Исправленная очистка текста ✓',
            'Безопасные FFmpeg фильтры ✓',
            'Упрощенный Ken Burns ✓',
            'Стабильные субтитры ✓'
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

// ГЛАВНЫЙ API ENDPOINT
app.post('/api/create-news-video', async (req, res) => {
  console.log('📨 Получен запрос на создание ИСПРАВЛЕННОГО новостного видео');
  console.log('📊 Параметры запроса:', JSON.stringify(req.body, null, 2));
  
  try {
    const {
      title = 'Важная новость дня',
      backgroundImage,
      duration = 45,
      channelName = 'AI Новости',
      subscribeText = 'ПОДПИШИСЬ НА КАНАЛ!',
      fast = false,
      enhanced = true,
      newsText = '',
      images = [],
      enableKenBurns = true
    } = req.body;

    const timestamp = Date.now();
    const videoFilename = `fixed_news_${timestamp}.mp4`;
    const outputPath = path.join(__dirname, 'outputs', videoFilename);
    const tempDir = path.join(__dirname, 'temp', `fixed_${timestamp}`);

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

    // Создаем видео с исправленной функцией
    const result = await createPerfectDynamicVideo(imagePaths, outputPath, {
      title,
      duration,
      channelName,
      subscribeText,
      newsText,
      fast,
      enableKenBurns
    });
    
    console.log('✅ ИСПРАВЛЕННОЕ видео создано успешно!');
    
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
      message: 'ИСПРАВЛЕННОЕ новостное видео создано! 🎬✨',
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
    console.error('❌ Ошибка при создании ИСПРАВЛЕННОГО видео:', error);
    res.status(500).json({
      error: 'Ошибка при создании исправленного новостного видео',
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
  console.log('🧪 Тест ИСПРАВЛЕННОЙ системы');
  
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
        message: 'ИСПРАВЛЕННАЯ система новостных видео готова!',
        ffmpegAvailable: code === 0,
        ffmpegVersion: output.split('\n')[0],
        features: [
          '✅ ИСПРАВЛЕННАЯ очистка текста для FFmpeg',
          '✅ Безопасное разделение субтитров',
          '✅ Упрощенные Ken Burns эффекты',
          '✅ Стабильные фильтры без сложной математики',
          '✅ Детальное логирование загрузки',
          '✅ Надежная обработка ошибок'
        ],
        improvements: [
          '🔧 Исправлена очистка двоеточий и спецсимволов',
          '🔧 Упрощены Ken Burns эффекты',
          '🔧 Укорочены тексты субтитров',
          '🔧 Убраны сложные математические выражения'
        ],
        limits: {
          maxImages: 4,
          maxDuration: 60,
          imageTimeout: 45,
          textLength: 100
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
    message: '🎬 FIXED Image-Based News Video API',
    version: '6.1.0 - ИСПРАВЛЕННАЯ',
    description: 'Исправленная система создания новостных видео из изображений',
    
    features: {
      '📥 Загрузка': 'Детальное логирование + проверка файлов',
      '📝 Текст': 'ИСПРАВЛЕННАЯ очистка и разделение',
      '🎬 Эффекты': 'Упрощенные Ken Burns (стабильные)',
      '📊 Фильтры': 'Безопасные FFmpeg команды',
      '🎨 Качество': 'Стабильное создание видео'
    },
    
    endpoints: {
      createVideo: 'POST /api/create-news-video',
      test: 'POST /api/test',
      download: 'GET /api/download/:filename',
      stream: 'GET /api/stream/:filename'
    },
    
    fixes: [
      '🔧 Исправлена обработка двоеточий в тексте',
      '🔧 Упрощены Ken Burns эффекты',
      '🔧 Сокращена длина субтитров',
      '🔧 Убраны проблемные символы',
      '🔧 Стабилизированы FFmpeg фильтры'
    ],
    
    status: 'Готова к созданию СТАБИЛЬНЫХ видео! 🚀✅'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🎬 ===== FIXED IMAGE-BASED NEWS VIDEO API =====');
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('✨ Режим: ИСПРАВЛЕННЫЕ стабильные видео');
  console.log('🔧 Исправления:');
  console.log('   📝 Безопасная очистка текста');
  console.log('   🎬 Упрощенные Ken Burns эффекты');
  console.log('   📊 Стабильные FFmpeg фильтры');
  console.log('   🎯 Укороченные субтитры');
  console.log('   ⚡ Надежная обработка символов');
  console.log('================================================');
});

export default app;
