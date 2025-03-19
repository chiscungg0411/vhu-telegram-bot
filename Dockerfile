# Sử dụng image Node.js chính thức với phiên bản slim
FROM node:20-slim

# Thiết lập thư mục làm việc
WORKDIR /app

# Cập nhật npm lên phiên bản mới nhất (sử dụng phiên bản hợp lệ)
RUN npm install -g npm@10.8.3

# Cài đặt các công cụ và thư viện cần thiết cho Puppeteer và Google Chrome
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libexpat1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxrender1 \
    xdg-utils \
    wget \
    gnupg \
    libvulkan1 \
    libcurl4 \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json và cài đặt dependencies
COPY package.json .
RUN npm install --production

# Copy toàn bộ code vào container
COPY . .

# Mở cổng cho ứng dụng
EXPOSE 10000

# Chạy ứng dụng
CMD ["npm", "start"]