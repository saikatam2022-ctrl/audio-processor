require('dotenv').config();
const express = require('express');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Audio Processor Running'));

app.post('/process', async (req, res) => {
  const { url } = req.body;
  
  if (!ytdl.validateURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const tempFile = `/tmp/audio-${Date.now()}.mp3`;

  try {
    await new Promise((resolve, reject) => {
      ytdl(url, { quality: 'highestaudio' })
        .pipe(fs.createWriteStream(tempFile))
        .on('finish', resolve)
        .on('error', reject);
    });

    const form = new FormData();
    form.append('file', fs.createReadStream(tempFile));

    const uploadRes = await axios.post(
      `${process.env.SUPABASE_URL}/storage/v1/object/audios/${Date.now()}.mp3`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
        },
      }
    );

    fs.unlinkSync(tempFile);
    res.json({ path: uploadRes.data.path });

  } catch (err) {
    console.error(err);
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    res.status(500).json({ error: 'Processing failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on ${PORT}`));
