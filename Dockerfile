# Sử dụng image node chính thức
FROM node:20-slim

# Thiết lập thư mục làm việc
WORKDIR /app

# Cập nhật npm lên phiên bản mới nhất
RUN npm install -g npm@11.2.0

# Cài đặt các công cụ và phụ thuộc cần thiết cho Puppeteer và Google Chrome
RUN apt-get update && apt-get install -y \
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
    libgtk-3-0 \
    libgbm-dev \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tải và cài đặt Google Chrome trực tiếp từ file .deb với thử lại nếu thất bại
RUN wget --quiet --tries=3 -O /tmp/google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && if [ ! -f /tmp/google-chrome-stable_current_amd64.deb ]; then echo "Error: Failed to download Google Chrome .deb file" && exit 1; fi \
    && dpkg -i /tmp/google-chrome-stable_current_amd64.deb || apt-get update && apt-get install -f -y \
    && rm /tmp/google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

# Xác minh Chrome được cài đặt
RUN if [ ! -f /usr/bin/google-chrome-stable ]; then echo "Error: Google Chrome not found at /usr/bin/google-chrome-stable" && exit 1; fi

# Copy package.json và cài đặt dependencies
COPY package.json .
RUN npm install

# Copy toàn bộ code vào container
COPY . .

# Mở cổng cho ứng dụng
EXPOSE 10000

# Chạy ứng dụng
CMD ["npm", "start"]
