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

  if (!url || !url.includes('youtube.com/watch')) {
    return res.status(400).json({ error: 'Invalid or missing YouTube URL' });
  }

  const timestamp = Date.now();
  const tempFile = `/tmp/audio-${timestamp}.mp3`;
  const fileName = `audio-${timestamp}.mp3`;
  const storagePath = `audios/${fileName}`;

  try {
    // Build yt-dlp command using npx
    const command = `${path.join(__dirname, 'bin', 'yt-dlp')} -x --audio-format mp3 --ffmpeg-location "${path.join(__dirname, 'bin', 'ffmpeg')}" -o "${tempFile}" "${url}"`;
    console.log(`Running command: ${command}`);

    // Run yt-dlp
    await new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        console.log('===== yt-dlp stdout =====');
        console.log(stdout);
        console.log('===== yt-dlp stderr =====');
        console.log(stderr);
        if (error) {
          console.error('===== yt-dlp error =====');
          console.error(error);
          return reject(new Error(`yt-dlp failed: ${stderr || error.message}`));
        }

        // Confirm if file was created
        if (!fs.existsSync(tempFile)) {
          console.error('yt-dlp did not create expected output file at:', tempFile);
          return reject(new Error('yt-dlp did not produce expected audio file'));
        }

        resolve();
      });
    });

    // Upload to Supabase Storage
    const fileContent = fs.readFileSync(tempFile);
    const { error: uploadError } = await supabase.storage
      .from('audios')
      .upload(storagePath, fileContent, {
        contentType: 'audio/mpeg',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('audios')
      .getPublicUrl(storagePath);

    // Insert record in Supabase DB
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

    // Cleanup
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
