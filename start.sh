#!/bin/bash

# Cập nhật danh sách package
apt-get update 

# Cài đặt Chromium
apt-get install -y chromium-browser

# Chạy bot
node bot.js
