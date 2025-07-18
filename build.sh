#!/bin/bash
# build.sh

# Give execute permission to yt-dlp and ffmpeg binaries
chmod +x ./bin/yt-dlp
chmod +x ./bin/ffmpeg

# Install node dependencies
npm install
