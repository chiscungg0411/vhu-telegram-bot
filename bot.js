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
  return await puppeteerExtra.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

// Hàm đăng nhập vào portal
async function login(page, username, password) {
  await page.goto("https://portal.vhu.edu.vn/login", {
    waitUntil: "domcontentloaded",
    timeout: 300000,
  });
  await page.waitForSelector("input[name='email']", { timeout: 30000 });
  await page.type("input[name='email']", username, { delay: 100 });
  await page.type("input[name='password']", password, { delay: 100 });
  await Promise.all([
    page.click("button[type='submit']"),
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 300000 }),
  ]);
  if (page.url().includes("login")) throw new Error("Sai tài khoản hoặc mật khẩu!");
  console.log("✅ Đăng nhập thành công.");
}

// Hàm lấy lịch học
async function getSchedule(weekOffset = 0) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.resourceType() === "image") req.abort();
      else req.continue();
    });

    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    await page.goto("https://portal.vhu.edu.vn/student/schedules", {
      waitUntil: "domcontentloaded",
      timeout: 300000,
    });

    // Trích xuất dữ liệu lịch học
    const scheduleData = await page.evaluate((offset) => {
      const weekTabs = document.querySelectorAll(".MuiTabs-root .MuiTab-root");
      const targetWeek = weekTabs[offset] || weekTabs[0]; // Tuần này (0) hoặc tuần sau (1)
      targetWeek.click();
      const rows = document.querySelectorAll("table tbody tr");
      const schedule = {};
      rows.forEach((row) => {
        const cols = row.querySelectorAll("td");
        const day = cols[0]?.textContent.trim();
        if (day) {
          schedule[day] = schedule[day] || [];
          schedule[day].push({
            subject: cols[1]?.textContent.trim(),
            time: cols[2]?.textContent.trim(),
            room: cols[3]?.textContent.trim(),
            professor: cols[4]?.textContent.trim(),
          });
        }
      });
      const weekInfo = document.querySelector(".MuiTabs-root .MuiTab-root.Mui-selected")?.textContent;
      return { schedule, week: weekInfo };
    }, weekOffset);

    await browser.close();
    return scheduleData;
  } catch (error) {
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
      if (req.resourceType() === "image") req.abort();
      else req.continue();
    });

    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    await page.goto("https://portal.vhu.edu.vn/student/notifications", {
      waitUntil: "domcontentloaded",
      timeout: 300000,
    });

    const notifications = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return Array.from(rows).map((row) => {
        const cols = row.querySelectorAll("td");
        return {
          MessageSubject: cols[0]?.textContent.trim(),
          SenderName: cols[1]?.textContent.trim(),
          CreationDate: cols[2]?.textContent.trim(),
        };
      });
    });

    await browser.close();
    return notifications;
  } catch (error) {
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
      if (req.resourceType() === "image") req.abort();
      else req.continue();
    });

    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    await page.goto("https://portal.vhu.edu.vn/student/socialworks", {
      waitUntil: "domcontentloaded",
      timeout: 300000,
    });

    const socialWork = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      return Array.from(rows).map((row) => {
        const cols = row.querySelectorAll("td");
        return {
          Details: cols[0]?.textContent.trim(),
          Location: cols[1]?.textContent.trim(),
          NumRegisted: cols[2]?.textContent.trim(),
          MarkConverted: cols[3]?.textContent.trim(),
          FromTime: cols[4]?.textContent.trim(),
          ToTime: cols[5]?.textContent.trim(),
        };
      });
    });

    await browser.close();
    return socialWork;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// Cấu hình server
const PORT = process.env.PORT || 10000;
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});
app.get("/ping", (req, res) => {
  res.status(200).send("Bot is alive!");
});

app.listen(PORT, () => {
  console.log(`Server chạy trên port ${PORT}`);
  bot.startPolling(); // Chuyển sang polling vì không dùng API
  console.log("✅ Bot đang chạy ở chế độ polling...");
});

// Xử lý lệnh Telegram
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "👋 Xin chào! Mình là Trợ lý VHU, người luôn cập nhật thông tin nhanh nhất cho bạn <3.\n" +
      "📅 Dùng /tuannay để xem lịch học tuần này.\n" +
      "📅 Dùng /tuansau để xem lịch học tuần sau.\n" +
      "🔔 Dùng /thongbao để xem danh sách thông báo.\n" +
      "📋 Dùng /congtac để xem danh sách công tác xã hội.\n" +
      "💡 *Mẹo:* Nhấn vào nút menu 📋 (gần ô nhập tin nhắn) để chọn lệnh nhanh!"
  );
});

bot.onText(/\/tuannay/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📅 Đang lấy thông tin lịch học tuần này, vui lòng chờ trong giây lát ⌛...");
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
    console.error("❌ Lỗi lấy lịch học:", error.message);
    bot.sendMessage(
      chatId,
      `❌ Lỗi: Không thể lấy lịch học. Chi tiết: ${error.message}`
    );
  }
});

bot.onText(/\/tuansau/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📅 Đang lấy thông tin lịch học tuần sau, vui lòng chờ trong giây lát ⌛...");
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
    console.error("❌ Lỗi lấy lịch học tuần sau:", error.message);
    bot.sendMessage(
      chatId,
      `❌ Lỗi: Không thể lấy lịch học tuần sau. Chi tiết: ${error.message}`
    );
  }
});

bot.onText(/\/thongbao/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🔔 Đang lấy thông tin thông báo, vui lòng chờ trong giây lát ⌛...");
  try {
    const notifications = await getNotifications();
    let message = "🔔 *Thông báo mới nhất:*\n*------------------------------------*\n";
    notifications.slice(0, 5).forEach((n, i) => {
      message += `📢 *${i + 1}. ${n.MessageSubject}*\n📩 ${n.SenderName || "Không rõ"}\n⏰ ${
        n.CreationDate || "Không rõ"
      }\n\n`;
    });
    if (notifications.length > 5) message += `📢 Còn ${notifications.length - 5} thông báo khác.`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("❌ Lỗi lấy thông báo:", error.message);
    bot.sendMessage(
      chatId,
      `❌ Lỗi: Không thể lấy thông báo. Chi tiết: ${error.message}`
    );
  }
});

bot.onText(/\/congtac/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📋 Đang lấy thông tin công tác xã hội, vui lòng chờ trong giây lát ⌛...");
  try {
    const congTacData = await getSocialWork();
    let message = "📋 *Công tác xã hội:*\n*------------------------------------*\n";
    congTacData.slice(0, 5).forEach((c, i) => {
      message += `📌 *${i + 1}. ${c.Details}*\n📍 ${c.Location || "Chưa rõ"}\n👥 ${
        c.NumRegisted || "Chưa rõ"
      } người đăng ký\n⭐ ${c.MarkConverted || "0"} điểm\n🕛 ${c.FromTime} - ${c.ToTime}\n\n`;
    });
    if (congTacData.length > 5) message += `📢 Còn ${congTacData.length - 5} công tác khác.`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("❌ Lỗi lấy công tác xã hội:", error.message);
    bot.sendMessage(
      chatId,
      `❌ Lỗi: Không thể lấy công tác xã hội. Chi tiết: ${error.message}`
    );
  }
});

console.log("🤖 Bot Telegram đang chạy...");