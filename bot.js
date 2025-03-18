require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const puppeteer = require("puppeteer");
const fs = require("fs").promises;

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const app = express();
app.use(express.json());
const bot = new TelegramBot(TOKEN);

let browser;
let page;
const CACHE_FILE = {
  schedules: "./cache_schedules.json",
  notifications: "./cache_notifications.json",
  socialWork: "./cache_socialWork.json",
};
const CACHE_DURATION = 2 * 60 * 60 * 1000;

async function loadFromCache(file) {
  try {
    const data = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(data);
    if (Date.now() - parsed.timestamp < CACHE_DURATION) return parsed.data;
    return null;
  } catch (error) {
    return null;
  }
}

async function saveToCache(file, data) {
  await fs.writeFile(file, JSON.stringify({ timestamp: Date.now(), data }), "utf8");
}

async function initializeBrowser() {
  if (browser) return;
  console.log("🔄 Khởi tạo trình duyệt Puppeteer...");
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
      ],
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
      timeout: 30000,
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const resourceType = req.resourceType();
      if (["image", "stylesheet", "font", "script", "media"].includes(resourceType)) req.abort();
      else req.continue();
    });
    await loginToPortal(page);
    console.log("✅ Trình duyệt và trang đã sẵn sàng!");
  } catch (error) {
    console.error("❌ Lỗi khởi tạo trình duyệt:", error.message);
    if (browser) await browser.close();
    browser = null;
    throw error;
  }
}

process.on("SIGINT", async () => {
  if (browser) {
    await browser.close();
    console.log("✅ Trình duyệt đã đóng.");
  }
  process.exit();
});

async function loginToPortal(page) {
  try {
    await page.goto("https://portal.vhu.edu.vn/login", { timeout: 10000, waitUntil: "networkidle0" });
    console.log("✅ Trang đăng nhập đã tải, kiểm tra selector...");
    await page.waitForSelector("input[name='email']", { timeout: 10000 });
    await page.type("input[name='email']", process.env.VHU_EMAIL);
    await page.type("input[name='password']", process.env.VHU_PASSWORD);
    await Promise.all([
      page.click("button[type='submit']"),
      page.waitForNavigation({ timeout: 15000 }),
    ]);

    if (page.url().includes("login")) throw new Error("Sai tài khoản hoặc mật khẩu!");
    console.log("✅ Đăng nhập thành công!");
  } catch (error) {
    console.error("❌ Lỗi đăng nhập:", error.message);
    throw error;
  }
}

async function getSchedule(weekOffset = 0) {
  try {
    await page.goto("https://portal.vhu.edu.vn/student/schedules", {
      timeout: 5000,
      waitUntil: "networkidle0",
    });
    await page.waitForSelector(".MuiTable-root", { timeout: 3000 });

    const yearDropdown = 'div[role="button"][id="demo-simple-select-helper"]';
    await page.click(yearDropdown);
    await page.evaluate(() => document.querySelector('li[data-value="2024-2025"]').click());

    const dropdowns = await page.$$(yearDropdown);
    await dropdowns[1].click();
    await page.evaluate(() => {
      const semester = document.querySelector('li[data-value="2"]');
      if (semester) semester.click();
    });

    await page.waitForSelector(".MuiTable-root tbody tr", { timeout: 3000 });
    const lichHoc = await page.evaluate(() => {
      const monHocTheoNgay = {};
      const headers = document.querySelectorAll(".MuiTable-root thead th");
      headers.forEach((th, i) => {
        if (i > 0) monHocTheoNgay[th.innerText.trim()] = [];
      });

      const rows = document.querySelectorAll(".MuiTable-root tbody tr");
      rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        cells.forEach((cell, i) => {
          if (i > 0 && cell.innerText.trim()) {
            const ngay = headers[i].innerText.trim();
            monHocTheoNgay[ngay].push(cell.innerText.trim().split("\n").join(" - "));
          }
        });
      });
      return monHocTheoNgay;
    });

    const cached = (await loadFromCache(CACHE_FILE.schedules)) || {};
    cached[`week${weekOffset}`] = lichHoc;
    await saveToCache(CACHE_FILE.schedules, cached);
    console.log(`✅ Đã cập nhật lịch học tuần ${weekOffset}`);
    return lichHoc;
  } catch (error) {
    console.error(`❌ Lỗi lấy lịch học tuần ${weekOffset}:`, error.message);
    throw error;
  }
}

async function getNotifications() {
  try {
    await page.goto("https://portal.vhu.edu.vn/student/index", {
      timeout: 5000,
      waitUntil: "networkidle0",
    });
    await page.waitForSelector("table.MuiTable-root", { timeout: 3000 });

    const notifications = await page.evaluate(() => {
      const items = document.querySelectorAll("table.MuiTable-root tbody tr");
      return Array.from(items)
        .map((row) => {
          const title = row.querySelector("td a.css-1qeq5on")?.innerText.trim();
          const sender = row.querySelector("td:nth-child(2)")?.innerText.trim();
          const date = row.querySelector("td:nth-child(3)")?.innerText.trim();
          return title ? { title, sender, date } : null;
        })
        .filter(Boolean);
    });

    await saveToCache(CACHE_FILE.notifications, notifications);
    console.log("✅ Đã cập nhật thông báo");
    return notifications;
  } catch (error) {
    console.error("❌ Lỗi lấy thông báo:", error.message);
    throw error;
  }
}

async function getSocialWork() {
  try {
    await page.goto("https://portal.vhu.edu.vn/student/congtacxahoi", {
      timeout: 5000,
      waitUntil: "networkidle0",
    });
    await page.waitForSelector("table.MuiTable-root", { timeout: 3000 });

    const yearDropdown = 'div[role="button"][id="demo-simple-select-helper"]';
    await page.click(yearDropdown);
    await page.evaluate(() => document.querySelector('li[data-value="2024-2025"]').click());

    const dropdowns = await page.$$(yearDropdown);
    await dropdowns[1].click();
    await page.evaluate(() => {
      const semester = document.querySelector('li[data-value="2"]');
      if (semester) semester.click();
    });

    await page.waitForSelector("table.MuiTable-root tbody tr", { timeout: 3000 });
    const congTacData = await page.evaluate(() => {
      const rows = document.querySelectorAll("table.MuiTable-root tbody tr");
      return Array.from(rows).map((row) => {
        const cols = row.querySelectorAll("td");
        return {
          suKien: cols[1]?.innerText.trim() || "Không có thông tin",
          diaDiem: cols[2]?.innerText.trim() || "Không có thông tin",
          soLuongDK: cols[3]?.innerText.trim() || "Không có thông tin",
          diem: cols[4]?.innerText.trim() || "Không có thông tin",
          batDau: cols[5]?.innerText.trim() || "Không có thông tin",
          ketThuc: cols[6]?.innerText.trim() || "Chưa có",
        };
      });
    });

    await saveToCache(CACHE_FILE.socialWork, congTacData);
    console.log("✅ Đã cập nhật công tác xã hội");
    return congTacData;
  } catch (error) {
    console.error("❌ Lỗi lấy công tác xã hội:", error.message);
    throw error;
  }
}

async function updateAllData() {
  try {
    if (!browser || !page) await initializeBrowser();
    await getSchedule(0);
    await getSchedule(1);
    await getNotifications();
    await getSocialWork();
    console.log("✅ Đã cập nhật toàn bộ dữ liệu vào cache");
  } catch (error) {
    console.error("❌ Lỗi cập nhật dữ liệu:", error.message);
    if (browser) await browser.close();
    browser = null;
  }
}

const PORT = process.env.PORT || 10000;
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});
app.get("/ping", (req, res) => res.send("Bot is alive!"));

app.listen(PORT, async () => {
  console.log(`Server chạy trên port ${PORT}`);
  process.env.PORT = PORT;
  const webhookUrl = `https://vhu-telegram-bot.onrender.com/bot${TOKEN}`;
  try {
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook đã đặt: ${webhookUrl}`);
  } catch (error) {
    console.error("❌ Lỗi thiết lập webhook:", error.message);
    console.log("🔄 Chuyển sang polling...");
    bot.startPolling({ polling: true });
  }
  setInterval(updateAllData, 60 * 60 * 1000);
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Xin chào! Mình là Trợ lý VHU.\n" +
      "📅 /tuannay - Lịch học tuần này\n" +
      "📅 /tuansau - Lịch học tuần sau\n" +
      "🔔 /thongbao - Danh sách thông báo\n" +
      "📋 /congtac - Công tác xã hội"
  );
});

bot.onText(/\/tuannay/, async (msg) => {
  const chatId = msg.chat.id;
  const cached = await loadFromCache(CACHE_FILE.schedules);
  const lichHoc = cached?.week0;
  if (!lichHoc) {
    bot.sendMessage(chatId, "📅 Đang khởi tạo dữ liệu, vui lòng đợi...");
    try {
      if (!browser || !page) await initializeBrowser();
      await updateAllData();
      const updatedCache = await loadFromCache(CACHE_FILE.schedules);
      const updatedLichHoc = updatedCache?.week0;
      if (!updatedLichHoc) throw new Error("Không thể lấy dữ liệu!");
      let message = "📅 *Lịch học tuần này:*\n*------------------------------------*\n";
      for (const [ngay, monHocs] of Object.entries(updatedLichHoc)) {
        message += `📌 *${ngay}:*\n${monHocs.length ? monHocs.map((m) => `📖 ${m}`).join("\n") : "❌ Không có lịch"}\n\n`;
      }
      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
    }
    return;
  }
  let message = "📅 *Lịch học tuần này:*\n*------------------------------------*\n";
  for (const [ngay, monHocs] of Object.entries(lichHoc)) {
    message += `📌 *${ngay}:*\n${monHocs.length ? monHocs.map((m) => `📖 ${m}`).join("\n") : "❌ Không có lịch"}\n\n`;
  }
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/tuansau/, async (msg) => {
  const chatId = msg.chat.id;
  const cached = await loadFromCache(CACHE_FILE.schedules);
  const lichHoc = cached?.week1;
  if (!lichHoc) {
    bot.sendMessage(chatId, "📅 Đang khởi tạo dữ liệu, vui lòng đợi...");
    try {
      if (!browser || !page) await initializeBrowser();
      await updateAllData();
      const updatedCache = await loadFromCache(CACHE_FILE.schedules);
      const updatedLichHoc = updatedCache?.week1;
      if (!updatedLichHoc) throw new Error("Không thể lấy dữ liệu!");
      let message = "📅 *Lịch học tuần sau:*\n*------------------------------------*\n";
      for (const [ngay, monHocs] of Object.entries(updatedLichHoc)) {
        message += `📌 *${ngay}:*\n${monHocs.length ? monHocs.map((m) => `📖 ${m}`).join("\n") : "❌ Không có lịch"}\n\n`;
      }
      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
    }
    return;
  }
  let message = "📅 *Lịch học tuần sau:*\n*------------------------------------*\n";
  for (const [ngay, monHocs] of Object.entries(lichHoc)) {
    message += `📌 *${ngay}:*\n${monHocs.length ? monHocs.map((m) => `📖 ${m}`).join("\n") : "❌ Không có lịch"}\n\n`;
  }
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/thongbao/, async (msg) => {
  const chatId = msg.chat.id;
  const notifications = await loadFromCache(CACHE_FILE.notifications);
  if (!notifications) {
    bot.sendMessage(chatId, "🔔 Đang khởi tạo dữ liệu, vui lòng đợi...");
    try {
      if (!browser || !page) await initializeBrowser();
      await updateAllData();
      const updatedNotifications = await loadFromCache(CACHE_FILE.notifications);
      if (!updatedNotifications) throw new Error("Không thể lấy dữ liệu!");
      if (!updatedNotifications.length) {
        bot.sendMessage(chatId, "🔔 Không có thông báo nào.");
        return;
      }
      const limited = updatedNotifications.slice(0, 5);
      let message = "🔔 *Thông báo mới nhất:*\n*------------------------------------*\n";
      limited.forEach((n, i) => {
        message += `📢 *${i + 1}. ${n.title}*\n📩 ${n.sender}\n⏰ ${n.date}\n\n`;
      });
      if (updatedNotifications.length > 5) message += `📢 Còn ${updatedNotifications.length - 5} thông báo khác.`;
      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
    }
    return;
  }
  if (!notifications.length) {
    bot.sendMessage(chatId, "🔔 Không có thông báo nào.");
    return;
  }
  const limited = notifications.slice(0, 5);
  let message = "🔔 *Thông báo mới nhất:*\n*------------------------------------*\n";
  limited.forEach((n, i) => {
    message += `📢 *${i + 1}. ${n.title}*\n📩 ${n.sender}\n⏰ ${n.date}\n\n`;
  });
  if (notifications.length > 5) message += `📢 Còn ${notifications.length - 5} thông báo khác.`;
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/congtac/, async (msg) => {
  const chatId = msg.chat.id;
  const congTacData = await loadFromCache(CACHE_FILE.socialWork);
  if (!congTacData) {
    bot.sendMessage(chatId, "📋 Đang khởi tạo dữ liệu, vui lòng đợi...");
    try {
      if (!browser || !page) await initializeBrowser();
      await updateAllData();
      const updatedCongTacData = await loadFromCache(CACHE_FILE.socialWork);
      if (!updatedCongTacData) throw new Error("Không thể lấy dữ liệu!");
      if (!updatedCongTacData.length) {
        bot.sendMessage(chatId, "📋 Không có công tác xã hội nào.");
        return;
      }
      const limited = updatedCongTacData.slice(0, 5);
      let message = "📋 *Công tác xã hội:*\n*------------------------------------*\n";
      limited.forEach((c, i) => {
        message += `📌 *${i + 1}. ${c.suKien}*\n📍 ${c.diaDiem}\n👥 ${c.soLuongDK}\n⭐ ${c.diem}\n🕛 ${c.batDau} - ${c.ketThuc}\n\n`;
      });
      if (updatedCongTacData.length > 5) message += `📢 Còn ${updatedCongTacData.length - 5} công tác khác.`;
      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
    }
    return;
  }
  if (!congTacData.length) {
    bot.sendMessage(chatId, "📋 Không có công tác xã hội nào.");
    return;
  }
  const limited = congTacData.slice(0, 5);
  let message = "📋 *Công tác xã hội:*\n*------------------------------------*\n";
  limited.forEach((c, i) => {
    message += `📌 *${i + 1}. ${c.suKien}*\n📍 ${c.diaDiem}\n👥 ${c.soLuongDK}\n⭐ ${c.diem}\n🕛 ${c.batDau} - ${c.ketThuc}\n\n`;
  });
  if (congTacData.length > 5) message += `📢 Còn ${congTacData.length - 5} công tác khác.`;
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

console.log("🤖 Bot Telegram đang chạy...");
