import "dotenv/config";
import puppeteer from "puppeteer-core";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";

// Khởi tạo bot Telegram
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Hàm chống spam API Telegram
async function safeSendMessage(chatId, message, options = {}) {
    try {
        await bot.sendMessage(chatId, message, { parse_mode: "Markdown", ...options });
    } catch (error) {
        if (error.response && error.response.statusCode === 429) {
            const retryAfter = error.response.body.parameters.retry_after || 5;
            console.warn(`⚠️ Telegram giới hạn API! Đợi ${retryAfter} giây trước khi gửi lại...`);
            setTimeout(() => safeSendMessage(chatId, message, options), retryAfter * 1000);
        } else {
            console.error("❌ Lỗi gửi tin nhắn:", error);
        }
    }
}

bot.onText(/\/lichhoc/, async (msg) => {
    const chatId = msg.chat.id;
    safeSendMessage(chatId, "📡 Đang lấy thông tin lịch học tuần này, vui lòng chờ...");

    try {
        const browser = await puppeteer.launch({
            executablePath: '/usr/bin/google-chrome-stable', // Dùng Chrome có sẵn trên Render
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        console.log("🔄 Truy cập trang đăng nhập...");
        await page.goto("https://portal.vhu.edu.vn/login", { waitUntil: "networkidle2", timeout: 90000 });

        await page.waitForSelector("input[name='email']", { timeout: 20000 });

        console.log("📩 Nhập tài khoản...");
        await page.type("input[name='email']", process.env.VHU_EMAIL, { delay: 100 });

        console.log("🔒 Nhập mật khẩu...");
        await page.type("input[name='password']", process.env.VHU_PASSWORD, { delay: 100 });

        console.log("🔓 Nhấn nút đăng nhập...");
        await page.click("button[type='submit']");
        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 90000 });

        console.log("📅 Truy cập trang lịch học...");
        await page.goto("https://portal.vhu.edu.vn/student/schedules", { waitUntil: "networkidle2", timeout: 90000 });

        const tableExists = await page.$(".MuiTable-root");
        if (!tableExists) {
            console.error("❌ Không tìm thấy bảng lịch học!");
            fs.writeFileSync("debug_schedule.html", await page.content());
            await browser.close();
            return safeSendMessage(chatId, "❌ Không tìm thấy lịch học. Kiểm tra file debug_schedule.html.");
        }

        console.log("✅ Lấy dữ liệu lịch học thành công.");
        const lichHoc = await page.evaluate(() => {
            const ngayHoc = [];
            const monHocTheoNgay = {};

            document.querySelectorAll(".MuiTable-root thead tr th").forEach((th, index) => {
                if (index > 0) {
                    ngayHoc.push(th.innerText.trim());
                    monHocTheoNgay[th.innerText.trim()] = [];
                }
            });

            document.querySelectorAll(".MuiTable-root tbody tr").forEach(row => {
                row.querySelectorAll("td").forEach((col, colIndex) => {
                    if (colIndex > 0 && col.innerText.trim()) {
                        monHocTheoNgay[ngayHoc[colIndex - 1]].push(col.innerText.trim());
                    }
                });
            });

            return monHocTheoNgay;
        });

        await browser.close();

        if (Object.keys(lichHoc).length === 0) {
            safeSendMessage(chatId, "❌ Không tìm thấy lịch học.");
        } else {
            let message = "📅 *Lịch học tuần này của bạn:*\n";
            Object.entries(lichHoc).forEach(([ngay, monHocs]) => {
                message += `📌 *Ngày:* ${ngay}\n`;
                if (monHocs.length > 0) {
                    monHocs.forEach((monHoc) => {
                        message += `📖 *Phòng học - Môn học:* ${monHoc}\n\n`;
                    });
                } else {
                    message += "❌ Không có lịch học.\n";
                }
                message += "\n";
            });

            safeSendMessage(chatId, message);
        }
    } catch (error) {
        safeSendMessage(chatId, "❌ Lỗi khi lấy lịch học.");
        console.error(error);
    }
});

console.log("🤖 Bot Telegram đang chạy...");
