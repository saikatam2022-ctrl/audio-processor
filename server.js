require('dotenv').config();
const express = require('express');
const YTDlpWrap = require('yt-dlp-wrap');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Use local binaries
const ytdl = new YTDlpWrap(path.join(__dirname, 'bin', 'yt-dlp'));
ffmpeg.setFfmpegPath(path.join(__dirname, 'bin', 'ffmpeg'));

app.get('/', (req, res) => res.send('Audio Processor Running'));

app.post('/process', async (req, res) => {
  const { url } = req.body;

  if (!url || !url.includes('youtube.com/watch')) {
    return res.status(400).json({ error: 'Invalid or missing YouTube URL' });
  }

  const timestamp = Date.now();
  const tempFile = `/tmp/audio-${timestamp}.mp3`;
  const fileName = `audio-${timestamp}.mp3`;
  const storagePath = `audios/${fileName}`;

  try {
    // Step 1: Download audio using yt-dlp
    await ytdl.exec([
      url,
      '-x',
      '--audio-format', 'mp3',
      '-o', tempFile
    ]);

    // Step 2: Upload to Supabase Storage
    const fileContent = fs.readFileSync(tempFile);
    const { error: uploadError } = await supabase.storage
      .from('audios')
      .upload(storagePath, fileContent, {
        contentType: 'audio/mpeg',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Step 3: Get public URL
    const { data: urlData } = supabase.storage
      .from('audios')
      .getPublicUrl(storagePath);

    // Step 4: Insert record in Supabase DB
    const { data: dbData, error: dbError } = await supabase
      .from('audio_files')
      .insert([{
        audio_url: urlData.publicUrl,
        source_url: url,
        file_name: fileName,
        file_path: storagePath,
        created_at: new Date().toISOString(),
        status: 'processed'
      }])
      .select();

    if (dbError) throw dbError;

    // Step 5: Cleanup
    fs.unlinkSync(tempFile);

    res.json({
      success: true,
      audioUrl: urlData.publicUrl,
      dbRecord: dbData[0]
    });

  } catch (err) {
    console.error('Processing error:', err);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    res.status(500).json({ 
      error: 'Processing failed',
      details: err.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
