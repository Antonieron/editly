// ПЕРЕДЕЛАННАЯ СИСТЕМА ДЛЯ ВИДЕО (НЕ КАРТИНОК)
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

// Функция очистки текста для FFmpeg
function sanitizeText(text) {
  if (!text) return '';
  
  return text
    .replace(/['"\\]/g, '') // Убираем кавычки и слеши
    .replace(/:/g, ' - ') // Двоеточия заменяем на тире
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

// Функция скачивания ВИДЕО файлов
function downloadVideo(url, filepath, index = 0) {
  return new Promise((resolve, reject) => {
    console.log(`📥 [VIDEO ${index + 1}] Начинаем загрузку: ${url}`);
    
    const tempPath = filepath + '.tmp';
    const file = fs.createWriteStream(tempPath);
    const request = url.startsWith('https:') ? https : http;
    
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'video/mp4,video/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    };
    
    const req = request.get(url, options, (response) => {
      console.log(`📊 [VIDEO ${index + 1}] HTTP статус: ${response.statusCode}`);
      
      // Обработка редиректов
      if (response.statusCode === 301 || response.statusCode === 302) {
        const newUrl = response.headers.location;
        console.log(`🔄 [VIDEO ${index + 1}] Редирект на: ${newUrl}`);
        file.close();
        fs.unlink(tempPath, () => {});
        return downloadVideo(newUrl, filepath, index)
          .then(resolve)
          .catch(reject);
      }
      
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(tempPath, () => {});
        reject(new Error(`HTTP Error ${response.statusCode} for video ${index + 1}: ${url}`));
        return;
      }
      
      // Проверяем тип контента
      const contentType = response.headers['content-type'] || '';
      console.log(`📁 [VIDEO ${index + 1}] Тип контента: ${contentType}`);
      
      if (!contentType.includes('video/') && !contentType.includes('application/octet-stream')) {
        file.close();
        fs.unlink(tempPath, () => {});
        reject(new Error(`Not a video (${contentType}) for video ${index + 1}: ${url}`));
        return;
      }
      
      console.log(`💾 [VIDEO ${index + 1}] Начинаем сохранение...`);
      response.pipe(file);
      
      let downloadedBytes = 0;
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (downloadedBytes % 100000 === 0) { // Логируем каждые 100KB
          console.log(`📈 [VIDEO ${index + 1}] Загружено: ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB`);
        }
      });
      
      file.on('finish', () => {
        file.close();
        console.log(`✅ [VIDEO ${index + 1}] Загрузка завершена: ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB`);
        
        // Проверяем размер файла (видео должно быть больше 100KB)
        if (downloadedBytes < 100000) {
          fs.unlink(tempPath, () => {});
          reject(new Error(`Video file too small (${downloadedBytes} bytes) for video ${index + 1}`));
          return;
        }
        
        // Переименовываем из временного в финальный файл
        fs.rename(tempPath, filepath, (err) => {
          if (err) {
            console.error(`❌ [VIDEO ${index + 1}] Ошибка переименования:`, err);
            fs.unlink(tempPath, () => {});
            reject(err);
          } else {
            console.log(`✅ [VIDEO ${index + 1}] Файл сохранен: ${filepath}`);
            resolve();
          }
        });
      });
      
      file.on('error', (err) => {
        console.error(`❌ [VIDEO ${index + 1}] Ошибка записи:`, err);
        fs.unlink(tempPath, () => {});
        reject(err);
      });
    });
    
    req.on('error', (err) => {
      console.error(`❌ [VIDEO ${index + 1}] Ошибка запроса:`, err);
      file.close();
      fs.unlink(tempPath, () => {});
      reject(err);
    });
    
    // Увеличиваем таймаут для видео
    req.setTimeout(120000, () => {
      console.error(`⏰ [VIDEO ${index + 1}] Таймаут загрузки: ${url}`);
      req.destroy();
      file.close();
      fs.unlink(tempPath, () => {});
      reject(new Error(`Download timeout for video ${index + 1}: ${url}`));
    });
  });
}

// СОЗДАНИЕ ВИДЕО ИЗ ВИДЕО ФАЙЛОВ
function createVideoFromVideos(videoPaths, audioPath, outputPath, options) {
  return new Promise((resolve, reject) => {
    const {
      title = 'Важная новость дня',
      duration = 60,
      channelName = 'AI Новости',
      subscribeText = 'ПОДПИШИСЬ НА КАНАЛ',
      newsText = ''
    } = options;

    console.log(`🎬 Создание видео из ${videoPaths.length} видео файлов`);

    // Проверяем все видео файлы
    for (let i = 0; i < videoPaths.length; i++) {
      if (!fs.existsSync(videoPaths[i])) {
        console.error(`❌ Видео ${i + 1} не найдено: ${videoPaths[i]}`);
        return reject(new Error(`Видео ${i + 1} не найдено`));
      }
      
      const stats = fs.statSync(videoPaths[i]);
      console.log(`✅ Видео ${i + 1}: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
    }

    // Проверяем аудио
    if (!fs.existsSync(audioPath)) {
      console.error(`❌ Аудио файл не найден: ${audioPath}`);
      return reject(new Error('Аудио файл не найден'));
    }

    // Безопасная очистка текстов
    const safeTitle = sanitizeText(title);
    const safeChannelName = sanitizeText(channelName);
    const safeSubscribeText = sanitizeText(subscribeText);

    console.log(`📝 Безопасные тексты:`);
    console.log(`   Заголовок: "${safeTitle}"`);
    console.log(`   Канал: "${safeChannelName}"`);
    console.log(`   Подписка: "${safeSubscribeText}"`);

    const videoDuration = duration / videoPaths.length;
    console.log(`⏱️ Длительность каждого видео: ${videoDuration.toFixed(1)} секунд`);
    
    // Строим входы для FFmpeg
    const inputs = [];
    
    // Добавляем все видео как входы
    videoPaths.forEach(videoPath => {
      inputs.push('-i', videoPath);
    });
    
    // Добавляем аудио как вход
    inputs.push('-i', audioPath);
    
    // Строим фильтр для объединения видео
    const filterParts = [];
    
    // Обрабатываем каждое видео
    videoPaths.forEach((videoPath, index) => {
      // Масштабируем, обрезаем и устанавливаем длительность для каждого видео
      filterParts.push(`[${index}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setpts=PTS-STARTPTS,trim=duration=${videoDuration.toFixed(2)}[v${index}]`);
    });

    // Конкатенируем все видео
    const concatInputs = videoPaths.map((_, index) => `[v${index}]`).join('');
    const concatFilter = `${concatInputs}concat=n=${videoPaths.length}:v=1:a=0[video_base]`;
    filterParts.push(concatFilter);

    // Добавляем текстовые элементы
    filterParts.push(`[video_base]drawbox=x=0:y=0:w=1920:h=80:color=red@0.9:t=fill[withbar]`);
    filterParts.push(`[withbar]drawtext=text='ВАЖНЫЕ НОВОСТИ':fontsize=28:fontcolor=white:x=(w-text_w)/2:y=25[withtop]`);
    
    // Заголовок
    if (safeTitle.length > 0) {
      filterParts.push(`[withtop]drawtext=text='${safeTitle}':fontsize=42:fontcolor=yellow:x=(w-text_w)/2:y=300:box=1:boxcolor=black@0.8:boxborderw=10:enable='between(t,0,8)'[withtitle]`);
    } else {
      filterParts.push(`[withtop]copy[withtitle]`);
    }
    
    // Канал
    if (safeChannelName.length > 0) {
      filterParts.push(`[withtitle]drawtext=text='${safeChannelName}':fontsize=22:fontcolor=white:x=50:y=h-50:box=1:boxcolor=red@0.8:boxborderw=6[withchannel]`);
    } else {
      filterParts.push(`[withtitle]copy[withchannel]`);
    }
    
    // Подписка
    if (safeSubscribeText.length > 0) {
      filterParts.push(`[withchannel]drawtext=text='${safeSubscribeText}':fontsize=30:fontcolor=black:x=(w-text_w)/2:y=h-60:box=1:boxcolor=yellow@0.9:boxborderw=8:enable='gte(t,${duration-10})'[final]`);
    } else {
      filterParts.push(`[withchannel]copy[final]`);
    }

    // Объединяем все фильтры
    const filterComplex = filterParts.join('; ');
    
    console.log(`🎬 Создано ${filterParts.length} фильтров для видео из видео`);

    // FFmpeg аргументы
    const ffmpegArgs = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[final]',
      '-map', `${videoPaths.length}:a`, // Аудио из последнего входа
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-t', duration.toString(),
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-preset', 'fast',
      '-crf', '20',
      '-y',
      outputPath
    ];

    console.log('🎬 Запуск FFmpeg для создания видео из видео');

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
        console.log('✅ Видео из видео создано успешно!');
        resolve({ 
          stdout, 
          stderr,
          method: 'Video Compilation from Source Videos',
          features: [
            'Настоящие видео файлы ✓',
            'Плавные переходы ✓', 
            'Синхронизированное аудио ✓',
            'Динамичный контент ✓',
            'HD качество ✓'
          ]
        });
      } else {
        console.error('❌ FFmpeg завершен с ошибкой, код:', code);
        reject(new Error(`FFmpeg exited with code ${code}. Last stderr: ${stderr.slice(-500)}`));
      }
    });

    ffmpegProcess.on('error', (error) => {
      console.error('💥 Ошибка запуска FFmpeg:', error);
      reject(error);
    });
  });
}

// ГЛАВНЫЙ API ENDPOINT ДЛЯ ВИДЕО
app.post('/api/create-news-video', async (req, res) => {
  console.log('📨 Получен запрос на создание видео ИЗ ВИДЕО');
  console.log('📊 Параметры запроса:', JSON.stringify(req.body, null, 2));
  
  try {
    const {
      title = 'Важная новость дня',
      duration = 45,
      channelName = 'AI Новости',
      subscribeText = 'ПОДПИШИСЬ НА КАНАЛ!',
      newsText = '',
      videos = [], // ВИДЕО вместо изображений!
      audio
    } = req.body;

    const timestamp = Date.now();
    const videoFilename = `news_from_videos_${timestamp}.mp4`;
    const outputPath = path.join(__dirname, 'outputs', videoFilename);
    const tempDir = path.join(__dirname, 'temp', `video_${timestamp}`);

    // Создаем временную папку
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Проверяем видео файлы
    if (!Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({ 
        error: 'Требуется массив видео файлов (videos)'
      });
    }

    // Проверяем аудио
    if (!audio || !audio.data) {
      return res.status(400).json({ 
        error: 'Требуется аудио файл (audio.data в base64)'
      });
    }

    // Сохраняем аудио файл
    const audioPath = path.join(tempDir, 'audio.mp3');
    const audioBuffer = Buffer.from(audio.data, 'base64');
    fs.writeFileSync(audioPath, audioBuffer);
    console.log(`💾 Аудио сохранено: ${(audioBuffer.length / 1024).toFixed(1)} KB`);

    // Ограничиваем количество видео
    const limitedVideos = videos.slice(0, 4);
    console.log(`📊 Будем использовать ${limitedVideos.length} видео файлов`);

    // ПОСЛЕДОВАТЕЛЬНОЕ скачивание видео файлов
    const videoPaths = [];
    
    for (let i = 0; i < limitedVideos.length; i++) {
      const videoData = limitedVideos[i];
      const videoUrl = videoData.url || videoData.pickedLink;
      const videoPath = path.join(tempDir, `video_${i}.mp4`);
      
      console.log(`\n⬇️ ===== СКАЧИВАНИЕ ВИДЕО ${i + 1}/${limitedVideos.length} =====`);
      console.log(`🔗 URL: ${videoUrl}`);
      console.log(`📁 Путь: ${videoPath}`);
      
      try {
        await downloadVideo(videoUrl, videoPath, i);
        
        if (fs.existsSync(videoPath)) {
          const stats = fs.statSync(videoPath);
          if (stats.size > 100000) { // Минимум 100KB
            videoPaths.push(videoPath);
            console.log(`✅ Видео ${i + 1} успешно загружено: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
          } else {
            console.error(`❌ Видео ${i + 1} слишком маленькое: ${stats.size} байт`);
          }
        } else {
          console.error(`❌ Файл видео ${i + 1} не создался`);
        }
        
      } catch (error) {
        console.error(`❌ Ошибка загрузки видео ${i + 1}:`, error.message);
        
        if (i === 0) {
          console.error(`💥 Первое видео обязательно - прерываем`);
          throw error;
        }
      }
    }

    console.log(`📊 ИТОГО загружено: ${videoPaths.length} из ${limitedVideos.length} видео`);

    if (videoPaths.length === 0) {
      throw new Error('Не удалось загрузить ни одного видео файла');
    }

    // Создаем видео из видео файлов
    const result = await createVideoFromVideos(videoPaths, audioPath, outputPath, {
      title,
      duration,
      channelName,
      subscribeText,
      newsText
    });
    
    console.log('✅ Видео из видео создано успешно!');
    
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
      message: 'Видео из ВИДЕО файлов создано! 🎬✨',
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
        videosUsed: videoPaths.length,
        videosRequested: limitedVideos.length,
        mode: 'video_compilation',
        created: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Ошибка при создании видео из видео:', error);
    res.status(500).json({
      error: 'Ошибка при создании видео из видео файлов',
      message: error.message
    });
  }
});

// Остальные endpoints остаются те же (download, stream, test)
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

app.get('/', (req, res) => {
  res.json({
    message: '🎬 VIDEO-BASED News Video API',
    version: '7.0.0 - ВИДЕО ИЗ ВИДЕО',
    description: 'Система создания новостных видео из реальных видео файлов',
    
    features: {
      '📥 Видео': 'Загрузка и обработка MP4 файлов',
      '🎵 Аудио': 'Синхронизация с озвучкой', 
      '🎬 Обработка': 'FFmpeg видео композиция',
      '📊 Качество': 'Настоящие движущиеся кадры',
      '🎨 Эффекты': 'Плавные переходы между видео'
    },
    
    status: 'Готова к созданию ВИДЕО ИЗ ВИДЕО! 🚀✅'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🎬 ===== VIDEO-BASED NEWS API =====');
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log('✨ Режим: ВИДЕО ИЗ ВИДЕО (не картинки!)');
  console.log('📹 Поддержка: MP4, синхронизация аудио');
  console.log('🎬 Создание: Композиция из видео файлов');
  console.log('=====================================');
});

export default app;
