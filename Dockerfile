# Sử dụng image Node.js chính thức
FROM node:18

# Cài đặt Chromium và các phụ thuộc cần thiết
RUN apt-get update && apt-get install -y \
    chromium \
    libxss1 \
    libxtst6 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxi6 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc
WORKDIR /app

# Sao chép package.json và cài đặt dependencies
COPY package.json .
RUN npm install

# Sao chép toàn bộ mã nguồn
COPY . .

# Đặt biến môi trường để Puppeteer dùng Chromium hệ thống
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chạy bot
CMD ["node", "bot.js"]
