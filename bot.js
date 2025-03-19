require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");
const fs = require("fs").promises;
const NodeCache = require("node-cache");
const axiosRetry = require("axios-retry").default;

// Cấu hình axios-retry với điều kiện thử lại cải tiến
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 2000, // Delay 2 giây mỗi lần thử lại
  retryCondition: (error) => {
    return (
      error.response?.status === 401 ||
      error.code === "ECONNABORTED" ||
      error.code === "ETIMEDOUT" || // Thêm xử lý timeout
      !error.response // Lỗi không có phản hồi (mạng)
    );
  },
});

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const app = express();
app.use(express.json());
const bot = new TelegramBot(TOKEN);

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error.message);
});

const CACHE_FILE = {
  schedules: "./cache_schedules.json",
  weeks: "./cache_weeks.json",
  yearandterm: "./cache_yearandterm.json",
  notifications: "./cache_notifications.json",
  socialWork: "./cache_socialWork.json",
};
const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6 giờ
const cache = new NodeCache({ stdTTL: CACHE_DURATION });

async function loadFromCache(file) {
  const cached = cache.get(file);
  if (cached) return cached;

  try {
    const data = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(data);
    if (Date.now() - parsed.timestamp < CACHE_DURATION) {
      cache.set(file, parsed.data);
      return parsed.data;
    }
    return null;
  } catch (error) {
    console.error(`❌ Lỗi đọc cache từ ${file}:`, error.message);
    return null;
  }
}

async function saveToCache(file, data) {
  cache.set(file, data);
  await fs.writeFile(file, JSON.stringify({ timestamp: Date.now(), data }), "utf8");
}

async function ensureCacheDir() {
  try {
    await fs.mkdir("./cache", { recursive: true });
    console.log("✅ Thư mục cache đã được tạo.");
  } catch (error) {
    console.error("❌ Lỗi tạo thư mục cache:", error.message);
  }
}

const API_BASE = "https://portal_api.vhu.edu.vn/api/student";
const AUTH_TOKEN = process.env.API_AUTH_TOKEN;

async function fetchData(endpoint, params = {}) {
  try {
    const response = await axios.get(`${API_BASE}${endpoint}`, {
      headers: { Authorization: AUTH_TOKEN },
      params,
      timeout: 30000, // Tăng timeout lên 30 giây
    });
    return response.data;
  } catch (error) {
    console.error(`❌ Lỗi gọi API ${endpoint}:`, error.message, error.response?.status);
    throw error;
  }
}

// Lấy danh sách tuần
async function getWeeks() {
  const cached = await loadFromCache(CACHE_FILE.weeks);
  if (cached) return cached;

  const data = await fetchData("/weeks");
  await saveToCache(CACHE_FILE.weeks, data);
  return data;
}

// Lấy năm và kỳ học
async function getYearAndTerm() {
  const cached = await loadFromCache(CACHE_FILE.yearandterm);
  if (cached) return cached;

  const data = await fetchData("/yearandterm");
  await saveToCache(CACHE_FILE.yearandterm, data);
  return data;
}

// Tính tuần hiện tại
async function getCurrentWeek() {
  const weeks = await getWeeks();
  const now = new Date();
  return (
    weeks.find((w) => {
      const [beginDay, beginMonth, beginYear] = w.BeginDate.split("/");
      const [endDay, endMonth, endYear] = w.EndDate.split("/");
      const begin = new Date(`${beginYear}-${beginMonth}-${beginDay}`);
      const end = new Date(`${endYear}-${endMonth}-${endDay}`);
      return now >= begin && now <= end;
    })?.Week || 12
  );
}

// Lấy lịch học
async function getSchedule(weekOffset = 0) {
  const currentWeek = (await getCurrentWeek()) + weekOffset;
  const { CurrentYear, CurrentTerm } = await getYearAndTerm();
  const params = { namhoc: CurrentYear, hocky: CurrentTerm, tuan: currentWeek };
  const cached = await loadFromCache(CACHE_FILE.schedules);
  if (cached?.[`week${weekOffset}`]) return cached[`week${weekOffset}`];

  const weeks = await getWeeks();
  const data = await fetchData("/DrawingSchedules", params);
  const lichHoc = processScheduleData(data, weeks.find((w) => w.Week === currentWeek));
  const cacheData = (await loadFromCache(CACHE_FILE.schedules)) || {};
  cacheData[`week${weekOffset}`] = lichHoc;
  await saveToCache(CACHE_FILE.schedules, cacheData);
  return lichHoc;
}

function processScheduleData(apiData, weekData) {
  const monHocTheoNgay = {};
  if (apiData.ResultDataSchedule) {
    apiData.ResultDataSchedule.forEach((schedule) => {
      const ngay = schedule.DayName || schedule.Thu;
      if (!monHocTheoNgay[ngay]) monHocTheoNgay[ngay] = [];
      monHocTheoNgay[ngay].push({
        subject: schedule.CurriculumName,
        time: schedule.CaHoc,
        room: schedule.RoomID.replace("</br>", " - "),
        professor: schedule.ProfessorName,
      });
    });
  } else {
    monHocTheoNgay["Lịch học"] = ["❌ Dữ liệu không hợp lệ"];
  }
  return {
    schedule: monHocTheoNgay,
    week: { BeginDate: weekData.BeginDate, EndDate: weekData.EndDate, DisPlayWeek: weekData.DisPlayWeek },
  };
}

// Lấy thông báo
async function getNotifications() {
  const cached = await loadFromCache(CACHE_FILE.notifications);
  if (cached) {
    console.log("✅ Sử dụng dữ liệu thông báo từ cache.");
    return cached;
  }

  try {
    const data = await fetchData("/notifications");
    const sortedData = data.sort((a, b) => new Date(b.CreationDate) - new Date(a.CreationDate));
    await saveToCache(CACHE_FILE.notifications, sortedData);
    console.log("✅ Đã lấy và lưu thông báo vào cache.");
    return sortedData;
  } catch (error) {
    console.error("❌ Lỗi lấy thông báo từ API:", error.message);
    throw new Error("Không thể tải thông báo do lỗi mạng hoặc timeout.");
  }
}

// Lấy công tác xã hội
async function getSocialWork() {
  const cached = await loadFromCache(CACHE_FILE.socialWork);
  if (cached) return cached;

  const data = await fetchData("/socialWork");
  const sortedData = data.result.sort((a, b) => new Date(b.UpdateDate) - new Date(a.UpdateDate));
  await saveToCache(CACHE_FILE.socialWork, sortedData);
  return sortedData;
}

const PORT = process.env.PORT || 10000;
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});
app.get("/ping", (req, res) => {
  res.status(200).send("Bot is alive!");
});

ensureCacheDir().then(() => {
  app.listen(PORT, async () => {
    console.log(`Server chạy trên port ${PORT}`);
    try {
      const webhookUrl = `https://vhu-telegram-bot.onrender.com/bot${TOKEN}`;
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook đã đặt: ${webhookUrl}`);
    } catch (error) {
      console.error("❌ Lỗi thiết lập webhook:", error.message);
      bot.startPolling();
    }
    console.log("✅ Bot đã sẵn sàng, chờ lệnh...");
  });
});

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
    let message = `📅 *Lịch học tuần ${lichHoc.week.DisPlayWeek || "này"}: ${lichHoc.week.BeginDate} - ${
      lichHoc.week.EndDate
    }*\n*------------------------------------*\n`;
    for (const [ngay, monHocs] of Object.entries(lichHoc.schedule)) {
      message += `📌 *${ngay}:*\n${
        monHocs.length
          ? monHocs.map((m) => `📖 ${m.subject} (${m.time} - ${m.room}, GV: ${m.professor})`).join("\n")
          : "❌ Không có lịch"
      }\n\n`;
    }
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("❌ Lỗi lấy lịch học:", error.message);
    bot.sendMessage(
      chatId,
      `❌ Lỗi: Không thể lấy lịch học. Vui lòng kiểm tra token hoặc thử lại sau. Chi tiết: ${error.message}`
    );
  }
});

bot.onText(/\/tuansau/, async (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "📅 Đang lấy thông tin lịch học tuần sau, vui lòng chờ trong giây lát ⌛...");
  try {
    const lichHoc = await getSchedule(1);
    let message = `📅 *Lịch học tuần ${lichHoc.week.DisPlayWeek || "sau"}: ${lichHoc.week.BeginDate} - ${
      lichHoc.week.EndDate
    }*\n*------------------------------------*\n`;
    for (const [ngay, monHocs] of Object.entries(lichHoc.schedule)) {
      message += `📌 *${ngay}:*\n${
        monHocs.length
          ? monHocs.map((m) => `📖 ${m.subject} (${m.time} - ${m.room}, GV: ${m.professor})`).join("\n")
          : "❌ Không có lịch"
      }\n\n`;
    }
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("❌ Lỗi lấy lịch học tuần sau:", error.message);
    bot.sendMessage(
      chatId,
      `❌ Lỗi: Không thể lấy lịch học tuần sau. Vui lòng kiểm tra token hoặc thử lại sau. Chi tiết: ${error.message}`
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
    console.error("❌ Lỗi xử lý lệnh /thongbao:", error.message);
    bot.sendMessage(
      chatId,
      `❌ Lỗi: Không thể lấy thông báo. Vui lòng thử lại sau. Chi tiết: ${error.message}`
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
      const fromTime = new Date(c.FromTime).toLocaleString("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      });
      const toTime = new Date(c.ToTime).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
      message += `📌 *${i + 1}. ${c.Details}*\n📍 ${c.Location || "Chưa rõ"}\n👥 ${
        c.NumRegisted || "Chưa rõ"
      } người đăng ký\n⭐ ${c.MarkConverted || "0"} điểm\n🕛 ${fromTime} - ${toTime}\n\n`;
    });
    if (congTacData.length > 5) message += `📢 Còn ${congTacData.length - 5} công tác khác.`;
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("❌ Lỗi lấy công tác xã hội:", error.message);
    bot.sendMessage(
      chatId,
      `❌ Lỗi: Không thể lấy công tác xã hội. Vui lòng kiểm tra token hoặc thử lại sau. Chi tiết: ${error.message}`
    );
  }
});

console.log("🤖 Bot Telegram đang chạy...");