require('dotenv').config();
const express = require('express');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.get('/', (req, res) => res.send('Audio Processor Running'));

app.post('/process', async (req, res) => {
  const { url } = req.body;
  
  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const tempFile = `/tmp/audio-${Date.now()}.mp3`;
  const fileName = `audio-${Date.now()}.mp3`;
  const storagePath = `audios/${fileName}`;

  try {
    // Step 1: Download and convert audio
    await new Promise((resolve, reject) => {
      ytdl(url, { quality: 'highestaudio' })
        .pipe(fs.createWriteStream(tempFile))
        .on('finish', resolve)
        .on('error', reject);
    });

    // Step 2: Upload to Supabase Storage
    const fileContent = fs.readFileSync(tempFile);
    const { data: uploadData, error: uploadError } = await supabase.storage
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

    // Step 4: Insert record into audio_files table
    const { data: dbData, error: dbError } = await supabase
      .from('audio_files')
      .insert([
        {
          audio_url: urlData.publicUrl,
          source_url: url,
          file_name: fileName,
          file_path: storagePath,
          created_at: new Date().toISOString(),
          status: 'processed'
        }
      ])
      .select();

    if (dbError) throw dbError;

    // Cleanup
    fs.unlinkSync(tempFile);

    // Response
    res.json({
      success: true,
      storagePath: storagePath,
      publicUrl: urlData.publicUrl,
      dbRecord: dbData[0]
    });

  } catch (err) {
    console.error(err);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    res.status(500).json({ 
      error: 'Processing failed',
      details: err.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
