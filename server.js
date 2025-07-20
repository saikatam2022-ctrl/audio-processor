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

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid URL' });
  }

  const timestamp = Date.now();
  const tempFile = `/tmp/audio-${timestamp}.mp3`;
  const fileName = `audio-${timestamp}.mp3`;
  const storagePath = `audios/${fileName}`;

  try {
    if (url.includes('youtube.com/watch') || url.includes('youtu.be')) {
      const command = `yt-dlp -x --audio-format mp3 -o "${tempFile}" "${url}"`;
      console.log(`Running command: ${command}`);

      await new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
          console.log('yt-dlp stdout:\n', stdout);
          console.log('yt-dlp stderr:\n', stderr);
          if (error) return reject(new Error(`yt-dlp failed: ${stderr || error.message}`));
          if (!fs.existsSync(tempFile)) return reject(new Error('yt-dlp did not produce expected audio file'));
          resolve();
        });
      });
    } else if (url.endsWith('.mp3') || url.includes('.mp3')) {
      const command = `curl -L --output "${tempFile}" "${url}"`;
      console.log(`Downloading audio file: ${command}`);

      await new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
          console.log('curl stdout:\n', stdout);
          console.log('curl stderr:\n', stderr);
          if (error) return reject(new Error(`Failed to download file: ${stderr || error.message}`));
          if (!fs.existsSync(tempFile)) return reject(new Error('Download failed: File not found'));
          resolve();
        });
      });
    } else {
      return res.status(400).json({ error: 'Unsupported URL format' });
    }

    // Upload to Supabase Storage
    const fileBuffer = fs.readFileSync(tempFile);
    const fileStats = fs.statSync(tempFile);

    const { error: uploadError } = await supabase.storage
      .from('audios')
      .upload(storagePath, fileBuffer, {
        contentType: 'audio/mpeg',
        upsert: false
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('audios')
      .getPublicUrl(storagePath);

    // Insert metadata into DB
    const { data: dbData, error: dbError } = await supabase
      .from('audio_files')
      .insert([{
        user_id: 'anonymous', // Replace with actual user ID if needed
        original_name: fileName,
        file_path: storagePath,
        file_size: fileStats.size,
        mime_type: 'audio/mpeg',
        duration: null, // Optional: populate with ffprobe if needed
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        audio_url: urlData.publicUrl,
        source_url: url,
        status: 'processed'
      }])
      .select();

    if (dbError) throw dbError;

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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
