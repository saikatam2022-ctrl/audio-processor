require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.post('/process', async (req, res) => {
  const { url } = req.body;

  const isYouTube = url?.includes('youtube.com') || url?.includes('youtu.be');
  const isAudioFile = url?.match(/\.(mp3|wav|m4a|aac|ogg)$/i);

  if (!url || (!isYouTube && !isAudioFile)) {
    return res.status(400).json({ error: 'Invalid or unsupported URL' });
  }

  const timestamp = Date.now();
  const tempFile = `/tmp/audio-${timestamp}.mp3`;
  const fileName = `audio-${timestamp}.mp3`;
  const storagePath = `audios/${fileName}`;

  try {
    if (isYouTube) {
      const command = `yt-dlp -x --audio-format mp3 -o "${tempFile}" "${url}"`;
      console.log(`Running yt-dlp: ${command}`);

      await new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
          console.log('yt-dlp stdout:', stdout);
          console.log('yt-dlp stderr:', stderr);
          if (error) return reject(new Error(stderr || error.message));
          if (!fs.existsSync(tempFile)) return reject(new Error('yt-dlp did not produce expected audio file'));
          resolve();
        });
      });
    } else if (isAudioFile) {
      const command = `curl -L --output "${tempFile}" "${url}"`;
      console.log(`Downloading audio file: ${command}`);

      await new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
          console.log('curl stdout:', stdout);
          console.log('curl stderr:', stderr);
          if (error) return reject(new Error(`Failed to download file: ${stderr || error.message}`));
          if (!fs.existsSync(tempFile)) return reject(new Error('Audio file not downloaded'));
          resolve();
        });
      });
    }

    // Upload to Supabase Storage
    const fileContent = fs.readFileSync(tempFile);
    const { error: uploadError } = await supabase.storage
      .from('audios')
      .upload(storagePath, fileContent, {
        contentType: 'audio/mpeg',
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('audios').getPublicUrl(storagePath);

    // Insert record in Supabase Database
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

    // Delete temp file
    fs.unlinkSync(tempFile);

    res.json({
      success: true,
      audioUrl: urlData.publicUrl,
      dbRecord: dbData[0]
    });

  } catch (err) {
    console.error('Processing error:', err.message);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    res.status(500).json({ error: 'Processing failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
