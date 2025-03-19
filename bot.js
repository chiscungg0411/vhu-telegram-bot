require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const puppeteer = require("puppeteer-core");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const puppeteerExtra = require("puppeteer-extra");

puppeteerExtra.use(StealthPlugin());

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const app = express();
app.use(express.json());
const bot = new TelegramBot(TOKEN);

// Xử lý lỗi hệ thống
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
});

// Hàm khởi tạo trình duyệt Puppeteer
async function launchBrowser() {
  try {
    const browser = await puppeteerExtra.launch({
      executablePath: "/usr/bin/google-chrome-stable",
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
      ],
    });
    console.log("✅ Trình duyệt Puppeteer đã khởi động.");
    return browser;
  } catch (error) {
    console.error("❌ Lỗi khởi động trình duyệt:", error.message);
    throw new Error("Không thể khởi động trình duyệt.");
  }
}

// Hàm đăng nhập vào portal với retry
async function login(page, username, password, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔑 Thử đăng nhập lần ${attempt}...`);
      await page.goto("https://portal.vhu.edu.vn/login", {
        waitUntil: "networkidle2",
        timeout: 120000, // Tăng timeout lên 120 giây
      });
      console.log("✅ Trang đăng nhập đã tải.");

      await page.waitForSelector("input[name='email']", { timeout: 30000 });
      await page.type("input[name='email']", username, { delay: 50 });
      await page.type("input[name='password']", password, { delay: 50 });
      console.log("✍️ Đã nhập thông tin đăng nhập.");

      // Thêm user-agent để tránh bị chặn
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      );

      await Promise.all([
        page.click("button[type='submit']"),
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 120000 }),
      ]);

      // Kiểm tra xem đã đăng nhập thành công chưa
      await page.waitForSelector("body", { timeout: 30000 }); // Đảm bảo trang đã tải
      if (page.url().includes("login")) {
        throw new Error("Sai tài khoản hoặc mật khẩu!");
      }
      console.log("✅ Đăng nhập thành công.");
      return true;
    } catch (error) {
      console.error(`❌ Lỗi đăng nhập lần ${attempt}:`, error.message);
      if (attempt === retries) throw error;
      console.log("⏳ Thử lại sau 5 giây...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// Hàm lấy lịch học
async function getSchedule(weekOffset = 0) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "stylesheet", "font"].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    console.log("📅 Đang truy cập trang lịch học...");
    await page.goto("https://portal.vhu.edu.vn/student/schedules", {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    const scheduleData = await page.evaluate((offset) => {
      const weekTabs = document.querySelectorAll(".MuiTabs-root .MuiTab-root");
      if (!weekTabs.length) throw new Error("Không tìm thấy tab tuần!");
      const targetWeek = weekTabs[offset] || weekTabs[0];
      targetWeek.click();
      return new Promise((resolve) => {
        setTimeout(() => {
          const rows = document.querySelectorAll("table tbody tr");
          const schedule = {};
          rows.forEach((row) => {
            const cols = row.querySelectorAll("td");
            const day = cols[0]?.textContent.trim();
            if (day) {
              schedule[day] = schedule[day] || [];
              schedule[day].push({
                subject: cols[1]?.textContent.trim() || "Không rõ",
                time: cols[2]?.textContent.trim() || "Không rõ",
                room: cols[3]?.textContent.trim() || "Không rõ",
                professor: cols[4]?.textContent.trim() || "Không rõ",
              });
            }
          });
          const weekInfo = document.querySelector(".MuiTabs-root .MuiTab-root.Mui-selected")?.textContent || "Không rõ";
          resolve({ schedule, week: weekInfo });
        }, 2000);
      });
    }, weekOffset);

    console.log("✅ Đã lấy lịch học.");
    await browser.close();
    return scheduleData;
  } catch (error) {
    console.error("❌ Lỗi trong getSchedule:", error.message);
    await browser.close();
    throw error;
  }
}

// Hàm lấy thông báo
async function getNotifications() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "stylesheet", "font"].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    console.log("🔔 Đang truy cập trang thông báo...");
    await page.goto("https://portal.vhu.edu.vn/student/notifications", {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    const notifications = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      if (!rows.length) throw new Error("Không tìm thấy thông báo!");
      return Array.from(rows).map((row) => {
        const cols = row.querySelectorAll("td");
        return {
          MessageSubject: cols[0]?.textContent.trim() || "Không rõ",
          SenderName: cols[1]?.textContent.trim() || "Không rõ",
          CreationDate: cols[2]?.textContent.trim() || "Không rõ",
        };
      });
    });

    console.log("✅ Đã lấy thông báo.");
    await browser.close();
    return notifications;
  } catch (error) {
    console.error("❌ Lỗi trong getNotifications:", error.message);
    await browser.close();
    throw error;
  }
}

// Hàm lấy công tác xã hội
async function getSocialWork() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "stylesheet", "font"].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    console.log("📋 Đang truy cập trang công tác xã hội...");
    await page.goto("https://portal.vhu.edu.vn/student/socialworks", {
      waitUntil: "networkidle2",
      timeout: 120000,
    });

    const socialWork = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      if (!rows.length) throw new Error("Không tìm thấy dữ liệu công tác xã hội!");
      return Array.from(rows).map((row) => {
        const cols = row.querySelectorAll("td");
        return {
          Details: cols[0]?.textContent.trim() || "Không rõ",
          Location: cols[1]?.textContent.trim() || "Không rõ",
          NumRegisted: cols[2]?.textContent.trim() || "Không rõ",
          MarkConverted: cols[3]?.textContent.trim() || "0",
          FromTime: cols[4]?.textContent.trim() || "Không rõ",
          ToTime: cols[5]?.textContent.trim() || "Không rõ",
        };
      });
    });

    console.log("✅ Đã lấy công tác xã hội.");
    await browser.close();
    return socialWork;
  } catch (error) {
    console.error("❌ Lỗi trong getSocialWork:", error.message);
    await browser.close();
    throw error;
  }
}

// Cấu hình server
const PORT = process.env.PORT || 10000;
app.get("/ping", (req, res) => {
  res.status(200).send("Bot is alive!");
});

app.listen(PORT, () => {
  console.log(`Server chạy trên port ${PORT}`);
  bot.startPolling({ polling: { interval: 500 } });
  console.log("✅ Bot đang chạy ở chế độ polling...");
});

// Xử lý lệnh Telegram
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "👋 Xin chào! Mình là Trợ lý VHU.\n" +
      "📅 /tuannay - Lịch học tuần này.\n" +
      "📅 /tuansau - Lịch học tuần sau.\n" +
      "🔔 /thongbao - Danh sách thông báo.\n" +
      "📋 /congtac - Công tác xã hội.\n" +
      "💡 Nhấn nút menu 📋 để chọn lệnh nhanh!"
  );
});

bot.onText(/\/tuannay/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📅 Đang lấy lịch học tuần này, vui lòng chờ...");
  try {
    const lichHoc = await getSchedule(0);
    let message = `📅 *Lịch học tuần ${lichHoc.week || "này"}*\n*------------------------------------*\n`;
    for (const [ngay, monHocs] of Object.entries(lichHoc.schedule)) {
      message += `📌 *${ngay}:*\n${
        monHocs.length
          ? monHocs
              .map((m) => `📖 ${m.subject} (${m.time} - ${m.room}, GV: ${m.professor})`)
              .join("\n")
          : "❌ Không có lịch"
      }\n\n`;
    }
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi lấy lịch học: ${error.message}`);
  }
});

bot.onText(/\/tuansau/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📅 Đang lấy lịch học tuần sau, vui lòng chờ...");
  try {
    const lichHoc = await getSchedule(1);
    let message = `📅 *Lịch học tuần ${lichHoc.week || "sau"}*\n*------------------------------------*\n`;
    for (const [ngay, monHocs] of Object.entries(lichHoc.schedule)) {
      message += `📌 *${ngay}:*\n${
        monHocs.length
          ? monHocs
              .map((m) => `📖 ${m.subject} (${m.time} - ${m.room}, GV: ${m.professor})`)
              .join("\n")
          : "❌ Không có lịch"
      }\n\n`;
    }
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi lấy lịch học tuần sau: ${error.message}`);
  }
});

bot.onText(/\/thongbao/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🔔 Đang lấy thông báo, vui lòng chờ...");
  try {
    const notifications = await getNotifications();
    let message = "🔔 *Thông báo mới nhất:*\n*------------------------------------*\n";
    notifications.slice(0, 5).forEach((n, i) => {
      message += `📢 *${i + 1}. ${n.MessageSubject}*\n📩 ${n.SenderName}\n⏰ ${n.CreationDate}\n\n`;
    });
    if (notifications.length > 5) message += `📢 Còn ${notifications.length - 5} thông báo khác.`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi lấy thông báo: ${error.message}`);
  }
});

bot.onText(/\/congtac/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📋 Đang lấy công tác xã hội, vui lòng chờ...");
  try {
    const congTacData = await getSocialWork();
    let message = "📋 *Công tác xã hội:*\n*------------------------------------*\n";
    congTacData.slice(0, 5).forEach((c, i) => {
      message += `📌 *${i + 1}. ${c.Details}*\n📍 ${c.Location}\n👥 ${c.NumRegisted} người đăng ký\n⭐ ${c.MarkConverted} điểm\n🕛 ${c.FromTime} - ${c.ToTime}\n\n`;
    });
    if (congTacData.length > 5) message += `📢 Còn ${congTacData.length - 5} công tác khác.`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi lấy công tác xã hội: ${error.message}`);
  }
});

console.log("🤖 Bot Telegram đang chạy...");
