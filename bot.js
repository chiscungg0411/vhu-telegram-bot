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
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
      ],
      defaultViewport: { width: 1280, height: 720 },
      timeout: 60000,
    });
    console.log("✅ Trình duyệt Puppeteer đã khởi động.");
    return browser;
  } catch (error) {
    console.error("❌ Lỗi khởi động trình duyệt:", error.message);
    throw new Error("Không thể khởi động trình duyệt.");
  }
}

// Hàm đăng nhập vào portal
async function login(page, username, password, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔑 Thử đăng nhập lần ${attempt}...`);
      await page.goto("https://portal.vhu.edu.vn/login", {
        waitUntil: "networkidle0",
        timeout: 120000,
      });
      console.log("✅ Trang đăng nhập đã tải.");

      await page.waitForSelector("input[name='email']", { timeout: 60000 });
      await page.type("input[name='email']", username, { delay: 100 });
      await page.waitForSelector("input[name='password']", { timeout: 60000 });
      await page.type("input[name='password']", password, { delay: 100 });
      console.log("✍️ Đã nhập thông tin đăng nhập.");

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      );

      await page.waitForSelector("button[type='submit']", { timeout: 60000 });
      await page.click("button[type='submit']");
      console.log("⏳ Đang chờ phản hồi sau đăng nhập...");

      await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 120000 });
      const finalUrl = page.url();
      console.log(`🌐 URL sau đăng nhập: ${finalUrl}`);

      const content = await page.content();
      if (finalUrl.includes("/login")) {
        console.log(`📄 Nội dung trang sau đăng nhập thất bại: ${content.slice(0, 500)}...`);
        const errorMessage = await page.evaluate(() => {
          if (document.body.innerText.includes("Username or password is incorrect")) return "Sai tên đăng nhập hoặc mật khẩu.";
          if (document.querySelector("iframe[src*='captcha']")) return "Yêu cầu CAPTCHA, không thể xử lý tự động.";
          return "Đăng nhập thất bại (lỗi không xác định).";
        });
        throw new Error(`Đăng nhập thất bại: ${errorMessage}`);
      }

      console.log("✅ Đăng nhập thành công:", finalUrl);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi đăng nhập lần ${attempt}:`, error.message);
      console.log(`🌐 URL khi lỗi: ${page.url()}`);
      const pageContent = await page.content();
      console.log(`📄 Nội dung trang khi lỗi: ${pageContent.slice(0, 500)}...`);
      if (attempt === retries) throw new Error(`Đăng nhập thất bại sau ${retries} lần: ${error.message}`);
      console.log("⏳ Thử lại sau 5 giây...");
      await page.close();
      await delay(5000);
      page = await (await launchBrowser()).newPage();
    }
  }
}

// Hàm lấy lịch học (sửa để tách ngày đúng và thay đổi tiêu đề tuần)
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
    const homeContent = await page.content();
    console.log(`📄 Nội dung trang chủ: ${homeContent.slice(0, 500)}...`);

    console.log("📅 Điều hướng trực tiếp đến lịch học...");
    await page.goto("https://portal.vhu.edu.vn/student/schedules", {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    console.log(`🌐 URL sau khi truy cập lịch học: ${page.url()}`);

    console.log("⏳ Đang chờ bảng lịch học tải...");
    await page.waitForSelector("#psc-table-head", { timeout: 120000 }).catch(async () => {
      const content = await page.content();
      console.log(`❌ Không tìm thấy #psc-table-head. Nội dung trang: ${content.slice(0, 1000)}...`);
      if (content.includes("captcha") || content.includes("verify")) {
        throw new Error("Trang yêu cầu CAPTCHA, không thể tự động xử lý.");
      } else if (content.includes("login")) {
        throw new Error("Phiên đăng nhập thất bại, bị đưa về trang login.");
      } else {
        throw new Error("Không tìm thấy bảng lịch học, có thể giao diện đã thay đổi hoặc trang chưa tải xong.");
      }
    });

    const scheduleContent = await page.content();
    console.log(`📄 Nội dung trang lịch học: ${scheduleContent.slice(0, 500)}...`);

    const scheduleData = await page.evaluate(() => {
      const table = document.querySelector("#psc-table-head");
      if (!table) throw new Error("Không tìm thấy bảng lịch học!");

      const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
        th.textContent.trim().replace(/\s+/g, " ") // Chuẩn hóa khoảng trắng
      );
      const days = headers.slice(1); // Bỏ cột "Tiết"
      const schedule = {};

      days.forEach((day, dayIndex) => {
        const dayParts = day.match(/^(Thứ \d|Chủ nhật) (\d{2}\/\d{2}\/\d{4})$/); // Tách "Thứ X" và "dd/mm/yyyy"
        const dayName = dayParts ? dayParts[1] : "Không rõ";
        const date = dayParts ? dayParts[2] : "Không rõ";
        const formattedDay = `${dayName} (${date})`;
        schedule[formattedDay] = [];
        const cells = table.querySelectorAll(`tbody td:nth-child(${dayIndex + 2})`);
        cells.forEach((cell) => {
          const detail = cell.querySelector(".DetailSchedule");
          if (detail) {
            const spans = detail.querySelectorAll("span");
            const subjectFull = spans[1]?.textContent.trim() || "Không rõ";
            const subjectMatch = subjectFull.match(/(.*) \((.*)\)/); // Tách tên và mã lớp
            schedule[formattedDay].push({
              room: spans[0]?.textContent.trim() || "Không rõ",
              subject: subjectMatch ? subjectMatch[1] : subjectFull,
              classCode: subjectMatch ? subjectMatch[2] : "Không rõ",
              periods: spans[4]?.textContent.replace("Tiết: ", "").trim() || "Không rõ",
              startTime: spans[5]?.textContent.replace("Giờ bắt đầu: ", "").trim() || "Không rõ",
              professor: spans[6]?.textContent.replace("GV: ", "").trim() || "Không rõ",
              email: spans[7]?.textContent.replace("Email: ", "").trim() || "",
            });
          }
        });
      });

      // Tiêu đề tuần cố định theo yêu cầu
      const weekInfo = "này của bạn";

      return { schedule, week: weekInfo };
    });

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
    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    console.log("🏠 Điều hướng đến trang chủ sinh viên...");
    await page.goto("https://portal.vhu.edu.vn/student", {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    console.log(`🌐 URL sau khi vào trang chủ: ${page.url()}`);
    const homeContent = await page.content();
    console.log(`📄 Nội dung trang chủ: ${homeContent.slice(0, 500)}...`);

    console.log("🔔 Điều hướng trực tiếp đến thông báo...");
    await page.goto("https://portal.vhu.edu.vn/student/index", {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    console.log(`🌐 URL sau khi truy cập thông báo: ${page.url()}`);

    console.log("⏳ Đang chờ bảng thông báo tải...");
    await page.waitForSelector(".MuiTableBody-root", { timeout: 120000 }).catch(async () => {
      const content = await page.content();
      console.log(`❌ Không tìm thấy .MuiTableBody-root. Nội dung trang: ${content.slice(0, 1000)}...`);
      if (content.includes("captcha") || content.includes("verify")) {
        throw new Error("Trang yêu cầu CAPTCHA, không thể tự động xử lý.");
      } else if (content.includes("login")) {
        throw new Error("Phiên đăng nhập thất bại, bị đưa về trang login.");
      } else {
        throw new Error("Không tìm thấy bảng thông báo, có thể giao diện đã thay đổi hoặc trang chưa tải xong.");
      }
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

    await page.waitForFunction(
      () => document.querySelector(".MuiTableBody-root") !== null,
      { timeout: 60000 }
    ).catch(async () => {
      const content = await page.content();
      throw new Error(`Không tìm thấy bảng công tác xã hội: ${content.slice(0, 500)}...`);
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

app.listen(PORT, async () => {
  console.log(`Server chạy trên port ${PORT}`);
  try {
    console.log("⏹️ Đang dừng polling cũ...");
    await bot.stopPolling();
    console.log("✅ Polling cũ đã dừng.");
    await bot.startPolling({ polling: { interval: 1000 } });
    console.log("✅ Bot đang chạy ở chế độ polling...");
  } catch (error) {
    console.error("❌ Lỗi khởi động polling:", error.message);
  }
});

// Xử lý lỗi polling
bot.on("polling_error", (error) => {
  console.error("❌ Polling error:", error.message);
});

// Xử lý lệnh Telegram
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
  bot.sendMessage(chatId, "📅 Đang lấy lịch học tuần này, vui lòng chờ...");
  try {
    const lichHoc = await getSchedule();
    let message = `📅 **Lịch học tuần này của bạn:**\n------------------------------------\n`;
    for (const [ngay, monHocs] of Object.entries(lichHoc.schedule)) {
      message += `📌 **${ngay}:**\n`;
      if (monHocs.length) {
        monHocs.forEach((m) => {
          message += `📖 **${m.subject} – ${m.classCode}**\n` +
                     `     (Tiết: ${m.periods}, Giờ bắt đầu: ${m.startTime} – Phòng học: ${m.room}, GV: ${m.professor}, Email: ${m.email})\n`;
        });
      } else {
        message += "❌ Không có lịch học\n";
      }
      message += "\n";
    }
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi lấy lịch học: ${error.message}`);
  }
});

bot.onText(/\/tuansau/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📅 Lệnh /tuansau đã bị xóa vì chỉ lấy lịch tuần hiện tại.");
});

bot.onText(/\/thongbao/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🔔 Đang lấy thông báo, vui lòng chờ...");
  try {
    const notifications = await getNotifications();
    let message = "🔔 **Thông báo mới nhất:**\n------------------------------------\n";
    notifications.slice(0, 5).forEach((n, i) => {
      message += `📢 **${i + 1}. ${n.MessageSubject}**\n📩 ${n.SenderName}\n⏰ ${n.CreationDate}\n\n`;
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
    let message = "📋 **Công tác xã hội:**\n------------------------------------\n";
    congTacData.slice(0, 5).forEach((c, i) => {
      message += `📌 **${c.Index}. ${c.Event}**\n📍 ${c.Location || "Chưa cập nhật"}\n👥 ${c.NumRegistered} người đăng ký\n⭐ ${c.Points} điểm\n🕛 ${c.StartTime} - ${c.EndTime}\n\n`;
    });
    if (congTacData.length > 5) message += `📢 Còn ${congTacData.length - 5} công tác khác.`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    bot.sendMessage(chatId, `❌ Lỗi lấy công tác xã hội: ${error.message}`);
  }
});

console.log("🤖 Bot Telegram đang khởi động...");
