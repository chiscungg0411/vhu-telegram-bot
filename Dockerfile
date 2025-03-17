# Sử dụng image Node.js chính thức, phiên bản 18.20.7
FROM node:18.20.7-slim

# Cài đặt các công cụ cần thiết cho Puppeteer
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy package.json và cài đặt dependencies
COPY package.json .
RUN npm install

# Copy toàn bộ code vào container
COPY . .

# Mở cổng
EXPOSE 3000

# Lệnh chạy ứng dụng
CMD ["node", "bot.js"]
