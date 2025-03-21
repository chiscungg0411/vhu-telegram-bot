require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const puppeteer = require("puppeteer-core");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const puppeteerExtra = require("puppeteer-extra");

puppeteerExtra.use(StealthPlugin());

// Hàm tiện ích để tạo độ trễ
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const app = express();
app.use(express.json());
const bot = new TelegramBot(TOKEN, { polling: { interval: 1000, autoStart: false } });

// **Xử lý lỗi hệ thống**
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
});

// **Hàm khởi tạo trình duyệt Puppeteer**
async function launchBrowser() {
  try {
    const browser = await puppeteerExtra.launch({
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--single-process", // Giảm tải tài nguyên
        "--no-zygote",
      ],
      defaultViewport: { width: 1280, height: 720 },
      timeout: 120000, // Tăng timeout lên 120 giây
    });
    console.log("✅ Trình duyệt Puppeteer đã khởi động.");
    return browser;
  } catch (error) {
    console.error("❌ Lỗi khởi động trình duyệt:", error.message);
    throw new Error("Không thể khởi động trình duyệt.");
  }
}

// **Hàm đăng nhập vào portal**
async function login(page, username, password, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔑 Thử đăng nhập lần ${attempt}...`);
      await page.goto("https://portal.vhu.edu.vn/login", {
        waitUntil: "networkidle0",
        timeout: 120000, // Tăng timeout lên 120 giây
      });
      console.log("✅ Trang đăng nhập đã tải.");

      // Kiểm tra xem có CAPTCHA không
      const hasCaptcha = await page.evaluate(() => !!document.querySelector("iframe[src*='captcha']"));
      if (hasCaptcha) {
        throw new Error("Trang yêu cầu CAPTCHA, không thể đăng nhập tự động.");
      }

      await page.waitForSelector("input[name='email']", { timeout: 120000 });
      await page.type("input[name='email']", username, { delay: 100 });
      await page.waitForSelector("input[name='password']", { timeout: 120000 });
      await page.type("input[name='password']", password, { delay: 100 });
      console.log("✍️ Đã nhập thông tin đăng nhập.");

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      );

      await page.waitForSelector("button[type='submit']", { timeout: 120000 });
      await page.click("button[type='submit']");
      console.log("⏳ Đang chờ phản hồi sau đăng nhập...");

      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 120000 });
      const finalUrl = page.url();
      console.log(`🌐 URL sau đăng nhập: ${finalUrl}`);

      if (finalUrl.includes("/login")) {
        const errorMessage = await page.evaluate(() => {
          if (document.body.innerText.includes("Username or password is incorrect")) return "Sai tên đăng nhập hoặc mật khẩu.";
          return "Đăng nhập thất bại (lỗi không xác định).";
        });
        throw new Error(`Đăng nhập thất bại: ${errorMessage}`);
      }

      console.log("✅ Đăng nhập thành công:", finalUrl);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi đăng nhập lần ${attempt}:`, error.message);
      if (attempt === retries) throw new Error(`Đăng nhập thất bại sau ${retries} lần: ${error.message}`);
      console.log("⏳ Thử lại sau 5 giây...");
      await page.close();
      await delay(5000);
      page = await (await launchBrowser()).newPage();
    }
  }
}

// **Hàm lấy lịch học (đã cập nhật)**
async function getSchedule() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    console.log("🏠 Điều hướng đến trang chủ sinh viên...");
    await page.goto("https://portal.vhu.edu.vn/student", {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    console.log(`🌐 URL sau khi vào trang chủ: ${page.url()}`);

    console.log("📅 Điều hướng trực tiếp đến lịch học...");
    await page.goto("https://portal.vhu.edu.vn/student/schedules", {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    console.log(`🌐 URL sau khi truy cập lịch học: ${page.url()}`);

    console.log("⏳ Đang chờ bảng lịch học tải...");
    await page.waitForSelector("#psc-table-head", { timeout: 120000 }).catch(async () => {
      const content = await page.content();
      throw new Error(`Không tìm thấy #psc-table-head. Nội dung trang: ${content.slice(0, 500)}...`);
    });

    const scheduleData = await page.evaluate(() => {
      const table = document.querySelector("#psc-table-head");
      if (!table) throw new Error("Không tìm thấy bảng lịch học!");

      // Tách "Thứ" và "Ngày" từ header
      const headers = Array.from(table.querySelectorAll("thead th")).map((th) => {
        const text = th.innerHTML.trim();
        const [thu, ngay] = text.split("<br>");
        return `${thu} - ${ngay}`;
      });
      const days = headers.slice(1); // Bỏ cột "Tiết"

      const schedule = {};
      days.forEach((day, dayIndex) => {
        schedule[day] = [];
        const cells = table.querySelectorAll(`tbody td:nth-child(${dayIndex + 2})`);
        cells.forEach((cell) => {
          const detail = cell.querySelector(".DetailSchedule");
          if (detail) {
            const spans = detail.querySelectorAll("span");
            const subjectFull = spans[1]?.textContent.trim() || "Không rõ";
            const subjectMatch = subjectFull.match(/(.*) \((.*)\)/); // Tách tên môn và mã lớp
            schedule[day].push({
              room: spans[0]?.textContent.trim() || "Không rõ",
              subject: subjectMatch ? subjectMatch[1] : subjectFull,
              classCode: subjectMatch ? subjectMatch[2] : "Không rõ",
              periods: spans[4]?.textContent.replace("Tiết: ", "").trim() || "Không rõ",
              startTime: spans[5]?.textContent.replace("Giờ bắt đầu: ", "").trim() || "Không rõ",
              professor: spans[6]?.textContent.replace("GV: ", "").trim() || "",
              email: spans[7]?.textContent.replace("Email: ", "").trim() || "",
            });
          }
        });
      });
      return { schedule, week: "này của bạn" };
    });

    console.log("✅ Đã lấy lịch học.");
    return scheduleData;
  } catch (error) {
    console.error("❌ Lỗi trong getSchedule:", error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// **Hàm lấy thông báo**
async function getNotifications() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    console.log("🏠 Điều hướng đến trang chủ sinh viên...");
    await page.goto("https://portal.vhu.edu.vn/student", {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    console.log(`🌐 URL sau khi vào trang chủ: ${page.url()}`);

    console.log("🔔 Điều hướng trực tiếp đến thông báo...");
    await page.goto("https://portal.vhu.edu.vn/student/index", {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    console.log(`🌐 URL sau khi truy cập thông báo: ${page.url()}`);

    console.log("⏳ Đang chờ bảng thông báo tải...");
    await page.waitForSelector(".MuiTableBody-root", { timeout: 120000 }).catch(async () => {
      const content = await page.content();
      throw new Error(`Không tìm thấy .MuiTableBody-root. Nội dung trang: ${content.slice(0, 500)}...`);
    });

    const notifications = await page.evaluate(() => {
      const rows = document.querySelectorAll(".MuiTableBody-root tr");
      if (!rows.length) throw new Error("Không tìm thấy thông báo!");
      return Array.from(rows).map((row) => {
        const cols = row.querySelectorAll("td");
        return {
          MessageSubject: cols[0]?.querySelector("a")?.textContent.trim() || "Không rõ",
          SenderName: cols[1]?.textContent.trim() || "Không rõ",
          CreationDate: cols[2]?.textContent.trim() || "Không rõ",
        };
      });
    });

    console.log("✅ Đã lấy thông báo.");
    return notifications;
  } catch (error) {
    console.error("❌ Lỗi trong getNotifications:", error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// **Hàm lấy công tác xã hội**
async function getSocialWork() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    console.log("🏠 Điều hướng đến trang chủ sinh viên...");
    await page.goto("https://portal.vhu.edu.vn/student", {
      waitUntil: "networkidle0",
      timeout: 120000,
    });

    console.log("📋 Điều hướng trực tiếp đến công tác xã hội...");
    await page.goto("https://portal.vhu.edu.vn/student/congtacxahoi", {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    console.log(`🌐 URL sau khi truy cập: ${page.url()}`);

    await page.waitForSelector(".MuiTableBody-root", { timeout: 120000 }).catch(async () => {
      const content = await page.content();
      throw new Error(`Không tìm thấy bảng công tác xã hội. Nội dung trang: ${content.slice(0, 500)}...`);
    });

    const socialWork = await page.evaluate(() => {
      const rows = document.querySelectorAll(".MuiTableBody-root tr");
      if (!rows.length) throw new Error("Không tìm thấy dữ liệu công tác xã hội!");
      return Array.from(rows).map((row) => {
        const cols = row.querySelectorAll("td");
        return {
          Index: cols[0]?.textContent.trim() || "Không rõ",
          Event: cols[1]?.textContent.trim() || "Không rõ",
          Location: cols[2]?.textContent.trim() || "Không rõ",
          NumRegistered: cols[3]?.textContent.trim() || "Không rõ",
          Points: cols[4]?.textContent.trim() || "0",
          StartTime: cols[5]?.textContent.trim() || "Không rõ",
          EndTime: cols[6]?.textContent.trim() || "Không rõ",
        };
      });
    });

    console.log("✅ Đã lấy công tác xã hội.");
    return socialWork;
  } catch (error) {
    console.error("❌ Lỗi trong getSocialWork:", error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

// **Cấu hình server**
const PORT = process.env.PORT || 10000;
app.get("/ping", (req, res) => res.status(200).send("Bot is alive!"));

app.listen(PORT, async () => {
  console.log(`Server chạy trên port ${PORT}`);
  try {
    console.log("⏹️ Đang dừng polling cũ...");
    await bot.stopPolling({ dropPendingUpdates: true }); // Thêm dropPendingUpdates để dừng hoàn toàn
    console.log("✅ Polling cũ đã dừng.");
    await bot.startPolling({ polling: { interval: 1000, restart: true } });
    console.log("✅ Bot đang chạy ở chế độ polling...");
  } catch (error) {
    console.error("❌ Lỗi khởi động polling:", error.message);
  }
});

// **Xử lý lỗi polling**
bot.on("polling_error", (error) => {
  console.error("❌ Polling error:", error.message);
});

// **Xử lý lệnh Telegram**
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(
    chatId,
    "👋 Xin chào! Mình là Trợ lý VHU.\n" +
      "📅 /tuannay - Lịch học tuần này.\n" +
      "🔔 /thongbao - Danh sách thông báo.\n" +
      "📋 /congtac - Công tác xã hội.\n" +
      "💡 Nhấn nút menu 📋 để chọn lệnh nhanh!"
  );
});

bot.onText(/\/tuannay/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📅 Đang lấy lịch học tuần này, vui lòng chờ trong giây ⌛...");
  try {
    const lichHoc = await getSchedule();
    let message = `📅 **Lịch học tuần ${lichHoc.week}**\n------------------------------------\n`;
    let hasSchedule = false;

    for (const [ngay, monHocs] of Object.entries(lichHoc.schedule)) {
      message += `📌 **${ngay}:**\n`;
      if (monHocs.length) {
        hasSchedule = true;
        monHocs.forEach((m) => {
          message += `📖 **Môn học: ${m.subject} – ${m.classCode}**\n` +
                     `📅 **Tiết:** ${m.periods}\n` +
                     `🕛 **Giờ bắt đầu:** ${m.startTime}\n` +
                     `📍 **Phòng học:** ${m.room}\n` +
                     `🧑‍🏫 **Giảng viên:** ${m.professor}\n` +
                     `📧 **Email:** ${m.email})\n`;
        });
      } else {
        message += "❌ Không có lịch\n";
      }
      message += "\n";
    }

    if (!hasSchedule) {
      message = `📅 **Lịch học tuần ${lichHoc.week}**\n------------------------------------\n❌ Không có lịch học trong tuần này.`;
    }

    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi lấy lịch học: ${error.message}`);
  }
});

bot.onText(/\/thongbao/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🔔 Đang lấy thông báo, vui lòng chờ trong giây ⌛...");
  try {
    const notifications = await getNotifications();
    let message = "🔔 **Danh sách thông báo mới nhất:**\n------------------------------------\n";
    notifications.slice(0, 5).forEach((n, i) => {
      message += `📢 **${i + 1}. ${n.MessageSubject}**\n📩 ${n.SenderName}\n⏰ ${n.CreationDate}\n\n`;
    });
    if (notifications.length > 5) message += `📢 Còn ${notifications.length - 5} thông báo khác. Hãy truy cập vào [Portal VHU](https://portal.vhu.edu.vn/login) để biết thêm thông tin chi tiết.`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi lấy thông báo: ${error.message}`);
  }
});

bot.onText(/\/congtac/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📋 Đang lấy danh sách công tác xã hội, vui lòng chờ trong giây ⌛...");
  try {
    const congTacData = await getSocialWork();
    let message = "📋 **Danh sách công tác xã hội:**\n------------------------------------\n";
    congTacData.slice(0, 5).forEach((c, i) => {
      message += `📌 **${c.Index}. ${c.Event}**\n📍 ${c.Location || "Chưa cập nhật"}\n👥 ${c.NumRegistered} người đăng ký\n⭐ ${c.Points} điểm\n🕛 ${c.StartTime} - ${c.EndTime}\n\n`;
    });
    if (congTacData.length > 5) message += `📢 Còn ${congTacData.length - 5} công tác khác. Hãy truy cập vào [Portal VHU](https://portal.vhu.edu.vn/login) để biết thêm thông tin chi tiết.`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi lấy công tác xã hội: ${error.message}`);
  }
});

console.log("🤖 Bot Telegram đang khởi động...");
