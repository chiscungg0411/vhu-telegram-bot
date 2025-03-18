require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");
const axios = require("axios");
const fs = require("fs").promises;

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
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 giờ

async function loadFromCache(file) {
  try {
    const data = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(data);
    if (Date.now() - parsed.timestamp < CACHE_DURATION) return parsed.data;
    return null;
  } catch (error) {
    console.error(`❌ Lỗi đọc cache từ ${file}:`, error.message);
    return null;
  }
}

async function saveToCache(file, data) {
  try {
    await fs.writeFile(file, JSON.stringify({ timestamp: Date.now(), data }), "utf8");
  } catch (error) {
    console.error(`❌ Lỗi lưu cache vào ${file}:`, error.message);
  }
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
    });
    return response.data;
  } catch (error) {
    console.error(`❌ Lỗi gọi API ${endpoint}:`, error.message);
    throw error;
  }
}

// Lấy danh sách tuần
async function getWeeks() {
  const cached = await loadFromCache(CACHE_FILE.weeks);
  if (cached) return cached;

  const data = await fetchData("/weeks"); // Thay bằng endpoint thực tế
  await saveToCache(CACHE_FILE.weeks, data);
  console.log("✅ Đã cập nhật danh sách tuần");
  return data;
}

// Lấy năm và kỳ học
async function getYearAndTerm() {
  const cached = await loadFromCache(CACHE_FILE.yearandterm);
  if (cached) return cached;

  const data = await fetchData("/yearandterm");
  await saveToCache(CACHE_FILE.yearandterm, data);
  console.log("✅ Đã cập nhật năm và kỳ học");
  return data;
}

// Tính tuần hiện tại dựa trên ngày
function getCurrentWeek(weeks) {
  const now = new Date();
  const currentDate = now.toLocaleDateString("en-GB"); // Định dạng dd/mm/yyyy
  return weeks.find(w => {
    const [beginDay, beginMonth, beginYear] = w.BeginDate.split("/");
    const [endDay, endMonth, endYear] = w.EndDate.split("/");
    const begin = new Date(`${beginYear}-${beginMonth}-${beginDay}`);
    const end = new Date(`${endYear}-${endMonth}-${endDay}`);
    return now >= begin && now <= end;
  })?.Week || 12; // Mặc định tuần 12 nếu không tìm thấy
}

// Lấy lịch học
async function getSchedule(weekOffset = 0) {
  const weeks = await getWeeks();
  const currentWeek = getCurrentWeek(weeks) + weekOffset;
  const { CurrentYear, CurrentTerm } = await getYearAndTerm();
  const params = {
    namhoc: CurrentYear,
    hocky: CurrentTerm,
    tuan: currentWeek,
  };
  const data = await fetchData("/DrawingSchedules", params);
  const lichHoc = processScheduleData(data, weeks.find(w => w.Week === currentWeek));
  const cached = (await loadFromCache(CACHE_FILE.schedules)) || {};
  cached[`week${weekOffset}`] = lichHoc;
  await saveToCache(CACHE_FILE.schedules, cached);
  console.log(`✅ Đã cập nhật lịch học tuần ${currentWeek}`);
  return lichHoc;
}

// Xử lý dữ liệu lịch học
function processScheduleData(apiData, weekData) {
  const monHocTheoNgay = {};
  if (apiData.ResultDataSchedule) {
    apiData.ResultDataSchedule.forEach(schedule => {
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
  return { schedule: monHocTheoNgay, week: weekData };
}

// Lấy thông báo
async function getNotifications() {
  const cached = await loadFromCache(CACHE_FILE.notifications);
  if (cached) return cached;

  const data = await fetchData("/notifications"); // Thay bằng endpoint thực tế
  const sortedData = data.sort((a, b) => new Date(b.CreationDate) - new Date(a.CreationDate));
  await saveToCache(CACHE_FILE.notifications, sortedData);
  console.log("✅ Đã cập nhật thông báo");
  return sortedData;
}

// Lấy công tác xã hội
async function getSocialWork() {
  const cached = await loadFromCache(CACHE_FILE.socialWork);
  if (cached) return cached;

  const data = await fetchData("/socialWork"); // Thay bằng endpoint thực tế
  const sortedData = data.result.sort((a, b) => new Date(b.UpdateDate) - new Date(a.UpdateDate));
  await saveToCache(CACHE_FILE.socialWork, sortedData);
  console.log("✅ Đã cập nhật công tác xã hội");
  return sortedData;
}

async function updateAllData() {
  try {
    const [schedule0, schedule1, notifications, socialWork] = await Promise.all([
      getSchedule(0),
      getSchedule(1),
      getNotifications(),
      getSocialWork(),
    ]);
    console.log("✅ Đã cập nhật toàn bộ dữ liệu vào cache");
    return { schedule0, schedule1, notifications, socialWork };
  } catch (error) {
    console.error("❌ Lỗi cập nhật dữ liệu:", error.message);
    throw error;
  }
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
  bot.sendMessage(chatId, "👋 Xin chào! Mình là Trợ lý VHU.\n📅 /tuannay\n📅 /tuansau\n🔔 /thongbao\n📋 /congtac");
});

bot.onText(/\/tuannay/, async (msg) => {
  const chatId = msg.chat.id;
  const cached = await loadFromCache(CACHE_FILE.schedules);
  const lichHoc = cached?.week0;
  if (!lichHoc) {
    bot.sendMessage(chatId, "📅 Đang tải dữ liệu...");
    try {
      await updateAllData();
      const updatedCache = await loadFromCache(CACHE_FILE.schedules);
      const updatedLichHoc = updatedCache?.week0;
      let message = `📅 *Lịch học tuần ${updatedLichHoc.week.DisPlayWeek || 'này'}: ${updatedLichHoc.week.BeginDate} - ${updatedLichHoc.week.EndDate}*\n*------------------------------------*\n`;
      for (const [ngay, monHocs] of Object.entries(updatedLichHoc.schedule)) {
        message += `📌 *${ngay}:*\n${monHocs.length ? monHocs.map(m => `📖 ${m.subject} (${m.time} - ${m.room}, GV: ${m.professor})`).join("\n") : "❌ Không có lịch"}\n\n`;
      }
      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
    }
    return;
  }
  let message = `📅 *Lịch học tuần ${lichHoc.week.DisPlayWeek || 'này'}: ${lichHoc.week.BeginDate} - ${lichHoc.week.EndDate}*\n*------------------------------------*\n`;
  for (const [ngay, monHocs] of Object.entries(lichHoc.schedule)) {
    message += `📌 *${ngay}:*\n${monHocs.length ? monHocs.map(m => `📖 ${m.subject} (${m.time} - ${m.room}, GV: ${m.professor})`).join("\n") : "❌ Không có lịch"}\n\n`;
  }
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/tuansau/, async (msg) => {
  const chatId = msg.chat.id;
  const cached = await loadFromCache(CACHE_FILE.schedules);
  const lichHoc = cached?.week1;
  if (!lichHoc) {
    bot.sendMessage(chatId, "📅 Đang tải dữ liệu...");
    try {
      await updateAllData();
      const updatedCache = await loadFromCache(CACHE_FILE.schedules);
      const updatedLichHoc = updatedCache?.week1;
      let message = `📅 *Lịch học tuần ${updatedLichHoc.week.DisPlayWeek || 'sau'}: ${updatedLichHoc.week.BeginDate} - ${updatedLichHoc.week.EndDate}*\n*------------------------------------*\n`;
      for (const [ngay, monHocs] of Object.entries(updatedLichHoc.schedule)) {
        message += `📌 *${ngay}:*\n${monHocs.length ? monHocs.map(m => `📖 ${m.subject} (${m.time} - ${m.room}, GV: ${m.professor})`).join("\n") : "❌ Không có lịch"}\n\n`;
      }
      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
    }
    return;
  }
  let message = `📅 *Lịch học tuần ${lichHoc.week.DisPlayWeek || 'sau'}: ${lichHoc.week.BeginDate} - ${lichHoc.week.EndDate}*\n*------------------------------------*\n`;
  for (const [ngay, monHocs] of Object.entries(lichHoc.schedule)) {
    message += `📌 *${ngay}:*\n${monHocs.length ? monHocs.map(m => `📖 ${m.subject} (${m.time} - ${m.room}, GV: ${m.professor})`).join("\n") : "❌ Không có lịch"}\n\n`;
  }
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/thongbao/, async (msg) => {
  const chatId = msg.chat.id;
  const notifications = await loadFromCache(CACHE_FILE.notifications);
  if (!notifications) {
    bot.sendMessage(chatId, "🔔 Đang tải dữ liệu...");
    try {
      await updateAllData();
      const updatedNotifications = await loadFromCache(CACHE_FILE.notifications);
      let message = "🔔 *Thông báo mới nhất:*\n*------------------------------------*\n";
      updatedNotifications.slice(0, 5).forEach((n, i) => {
        message += `📢 *${i + 1}. ${n.MessageSubject}*\n📩 ${n.SenderName || 'Không rõ'}\n⏰ ${n.CreationDate || 'Không rõ'}\n\n`;
      });
      if (updatedNotifications.length > 5) message += `📢 Còn ${updatedNotifications.length - 5} thông báo khác.`;
      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
    }
    return;
  }
  let message = "🔔 *Thông báo mới nhất:*\n*------------------------------------*\n";
  notifications.slice(0, 5).forEach((n, i) => {
    message += `📢 *${i + 1}. ${n.MessageSubject}*\n📩 ${n.SenderName || 'Không rõ'}\n⏰ ${n.CreationDate || 'Không rõ'}\n\n`;
  });
  if (notifications.length > 5) message += `📢 Còn ${notifications.length - 5} thông báo khác.`;
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/congtac/, async (msg) => {
  const chatId = msg.chat.id;
  const congTacData = await loadFromCache(CACHE_FILE.socialWork);
  if (!congTacData) {
    bot.sendMessage(chatId, "📋 Đang tải dữ liệu...");
    try {
      await updateAllData();
      const updatedCongTacData = await loadFromCache(CACHE_FILE.socialWork);
      let message = "📋 *Công tác xã hội:*\n*------------------------------------*\n";
      updatedCongTacData.slice(0, 5).forEach((c, i) => {
        const fromTime = new Date(c.FromTime).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
        const toTime = new Date(c.ToTime).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
        message += `📌 *${i + 1}. ${c.Details}*\n📍 ${c.Location || 'Chưa rõ'}\n👥 ${c.NumRegisted || 'Chưa rõ'} người đăng ký\n⭐ ${c.MarkConverted || '0'} điểm\n🕛 ${fromTime} - ${toTime}\n\n`;
      });
      if (updatedCongTacData.length > 5) message += `📢 Còn ${updatedCongTacData.length - 5} công tác khác.`;
      bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Lỗi: ${error.message}`);
    }
    return;
  }
  let message = "📋 *Công tác xã hội:*\n*------------------------------------*\n";
  congTacData.slice(0, 5).forEach((c, i) => {
    const fromTime = new Date(c.FromTime).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
    const toTime = new Date(c.ToTime).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
    message += `📌 *${i + 1}. ${c.Details}*\n📍 ${c.Location || 'Chưa rõ'}\n👥 ${c.NumRegisted || 'Chưa rõ'} người đăng ký\n⭐ ${c.MarkConverted || '0'} điểm\n🕛 ${fromTime} - ${toTime}\n\n`;
  });
  if (congTacData.length > 5) message += `📢 Còn ${congTacData.length - 5} công tác khác.`;
  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

console.log("🤖 Bot Telegram đang chạy...");
