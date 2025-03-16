# Sử dụng image Node.js slim để giảm kích thước
FROM node:18-slim

# Cài đặt chỉ các phụ thuộc tối thiểu cho Puppeteer
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
RUN npm install --production # Chỉ cài gói cần thiết để chạy

# Sao chép mã nguồn
COPY bot.js .

# Chạy bot
CMD ["node", "bot.js"]
