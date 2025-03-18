# Sử dụng image Node.js chính thức với phiên bản slim
FROM node:20-slim

# Thiết lập thư mục làm việc
WORKDIR /app

# Cập nhật npm lên phiên bản mới nhất
RUN npm install -g npm@11.2.0

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

# Tải và cài đặt Google Chrome với retry logic đơn giản
RUN wget --tries=3 --timeout=20 -O /tmp/google-chrome-stable_current_amd64.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && dpkg -i /tmp/google-chrome-stable_current_amd64.deb \
    && apt-get install -f -y \
    && rm /tmp/google-chrome-stable_current_amd64.deb \
    && rm -rf /var/lib/apt/lists/*

# Xác minh và tạo symlink nếu cần
RUN CHROME_PATH=$(which google-chrome-stable || find / -name "google-chrome-stable" 2>/dev/null | head -n 1) \
    && if [ -z "$CHROME_PATH" ]; then echo "Error: Google Chrome not found" && exit 1; fi \
    && echo "Chrome found at: $CHROME_PATH" \
    && if [ "$CHROME_PATH" != "/usr/bin/google-chrome-stable" ]; then \
         ln -sf "$CHROME_PATH" /usr/bin/google-chrome-stable \
         && echo "Created symlink to /usr/bin/google-chrome-stable"; \
       fi

# Xác minh Chrome đã sẵn sàng
RUN if [ ! -f /usr/bin/google-chrome-stable ]; then echo "Error: Google Chrome not found at /usr/bin/google-chrome-stable" && exit 1; fi

# Copy package.json và cài đặt dependencies
COPY package.json .
RUN npm install --production

# Copy toàn bộ code vào container
COPY . .

# Mở cổng cho ứng dụng
EXPOSE 10000

# Chạy ứng dụng
CMD ["npm", "start"]
