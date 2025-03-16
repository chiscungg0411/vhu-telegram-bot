# Sử dụng image Node.js chính thức
FROM node:18

# Cài đặt các phụ thuộc cần thiết cho Puppeteer (không cài Chromium vì Puppeteer sẽ tự tải)
RUN apt-get update && apt-get install -y \
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

# Chạy bot
CMD ["node", "bot.js"]
