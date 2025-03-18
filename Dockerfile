# Sử dụng image node chính thức
FROM node:20-slim

# Thiết lập thư mục làm việc
WORKDIR /app

# Cập nhật npm lên phiên bản mới nhất
RUN npm install -g npm@11.2.0

# Cài đặt các công cụ và phụ thuộc cần thiết cho Puppeteer và Google Chrome, bao gồm ca-certificates
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
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tải file .deb của Google Chrome với retry logic
RUN wget --verbose --tries=5 --timeout=20 --no-check-certificate -O /tmp/google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb || \
    (echo "Retry 1 failed, trying again..." && sleep 5 && \
     wget --verbose --tries=5 --timeout=20 --no-check-certificate -O /tmp/google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb) || \
    (echo "Error: Failed to download Google Chrome .deb file after retries" && exit 1)

# Cài đặt file .deb và sửa lỗi phụ thuộc
RUN dpkg -i /tmp/google-chrome-stable_current_amd64.deb || (apt-get update && apt-get install -f -y) \
    && rm /tmp/google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

# Debug đường dẫn Chrome và tạo symlink nếu cần
RUN echo "Checking Chrome installation path..." \
    && CHROME_PATH=$(find / -name "google-chrome-stable" 2>/dev/null | head -n 1) \
    && if [ -z "$CHROME_PATH" ]; then echo "Chrome not found in any path" && exit 1; fi \
    && echo "Chrome found at: $CHROME_PATH" \
    && if [ "$CHROME_PATH" != "/usr/bin/google-chrome-stable" ]; then \
         ln -sf "$CHROME_PATH" /usr/bin/google-chrome-stable \
         && echo "Created symlink from $CHROME_PATH to /usr/bin/google-chrome-stable"; \
       fi

# Xác minh Chrome được cài đặt tại đường dẫn mong muốn
RUN if [ ! -f /usr/bin/google-chrome-stable ]; then echo "Error: Google Chrome not found at /usr/bin/google-chrome-stable after symlink" && exit 1; fi

# Copy package.json và cài đặt dependencies
COPY package.json .
RUN npm install

# Copy toàn bộ code vào container
COPY . .

# Mở cổng cho ứng dụng
EXPOSE 10000

# Chạy ứng dụng
CMD ["npm", "start"]
