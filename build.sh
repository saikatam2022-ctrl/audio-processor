#!/bin/bash
# build.sh

# Install dependencies
apt-get update && apt-get install -y ffmpeg
pip3 install -U yt-dlp

# Install Node dependencies
npm install
