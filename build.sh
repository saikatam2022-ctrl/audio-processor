#!/bin/bash

# Install system dependencies
apt-get update && apt-get install -y ffmpeg python3 python3-pip

# Install yt-dlp via pip
pip3 install yt-dlp

# Install Node dependencies
npm install
