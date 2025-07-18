require('dotenv').config();
const express = require('express');
const YTDlpWrap = require('yt-dlp-wrap').default;
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
const { exec } = require('child_process');

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
    // Step 1: Build yt-dlp command manually
    const command = `${path.join(__dirname, 'bin', 'yt-dlp')} -x --audio-format mp3 --ffmpeg-location "${path.join(__dirname, 'bin', 'ffmpeg')}" -o "${tempFile}" "${url}"`;

    console.log(`Running command: ${command}`);

    // Step 2: Run yt-dlp with promise wrapper
    await new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        console.log('yt-dlp stdout:', stdout);
        console.log('yt-dlp stderr:', stderr);
        if (error) {
          console.error('yt-dlp error:', error);
          return reject(new Error(`yt-dlp failed: ${stderr}`));
        }
        resolve();
      });
    });

    // Step 3: Check if file exists
    if (!fs.existsSync(tempFile)) {
      throw new Error('yt-dlp did not produce expected audio file');
    }

    // Step 4: Upload to Supabase
    const fileContent = fs.readFileSync(tempFile);
    const { error: uploadError } = await supabase.storage
      .from('audios')
      .upload(storagePath, fileContent, {
        contentType: 'audio/mpeg',
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Step 5: Get public URL
    const { data: urlData } = supabase.storage
      .from('audios')
      .getPublicUrl(storagePath);

    // Step 6: Insert metadata
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
