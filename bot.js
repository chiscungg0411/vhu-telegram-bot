require("dotenv").config();
const puppeteer = require("puppeteer");
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });
const app = express();

// Endpoint để ping giữ bot sống
app.get("/ping", (req, res) => {
    res.send("Bot is alive!");
});

// Chạy server Express
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Xử lý lỗi polling
bot.on("polling_error", (error) => {
    console.error("[polling_error]", error.code, error.message);
    if (error.code === "ETELEGRAM" && error.message.includes("409 Conflict")) {
        console.log("🔴 Detected 409 Conflict. Stopping polling and restarting...");
        bot.stopPolling().then(() => {
            setTimeout(() => {
                bot.startPolling();
                console.log("🔄 Polling restarted.");
            }, 2000);
        });
    }
});

// Xử lý lệnh /lichhoc
bot.onText(/\/lichhoc/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "📡 Đang lấy thông tin lịch học tuần này, vui lòng chờ trong giây lát ⌛...");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Hàm retry với tối đa 3 lần
        const retry = async (fn, retries = 3, delay = 5000) => {
            for (let i = 0; i < retries; i++) {
                try {
                    return await fn();
                } catch (err) {
                    if (i === retries - 1) throw err;
                    console.log(`Retry ${i + 1}/${retries} after ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        };

        console.log("🔄 Truy cập trang đăng nhập...");
        await retry(() => page.goto("https://portal.vhu.edu.vn/login", { timeout: 120000 }));

        await new Promise(resolve => setTimeout(resolve, 4500));

        console.log("🔍 Kiểm tra input email...");
        const emailExists = await page.evaluate(() => !!document.querySelector("input[name='email']"));
        if (!emailExists) {
            console.error("❌ Không tìm thấy ô nhập email!");
            await browser.close();
            return bot.sendMessage(chatId, "❌ Không tìm thấy ô nhập email. Vui lòng kiểm tra lại hệ thống.");
        }

        console.log("📩 Nhập tài khoản...");
        await page.type("input[name='email']", process.env.VHU_EMAIL, { delay: 100 });

        console.log("🔒 Nhập mật khẩu...");
        await page.type("input[name='password']", process.env.VHU_PASSWORD, { delay: 100 });

        console.log("🔓 Nhấn nút đăng nhập...");
        await page.click("button[type='submit']");

        console.log("⌛ Đang đăng nhập...");
        await retry(() => page.waitForNavigation({ timeout: 120000 }));

        console.log("📅 Truy cập trang lịch học...");
        await retry(() => page.goto("https://portal.vhu.edu.vn/student/schedules", { timeout: 120000 }));

        console.log("⏳ Chờ trang tải hoàn tất...");
        await new Promise(resolve => setTimeout(resolve, 8300));

        console.log("📜 Kiểm tra dữ liệu lịch học...");
        const tableExists = await page.evaluate(() => !!document.querySelector(".MuiTable-root"));
        if (!tableExists) {
            console.error("❌ Không tìm thấy bảng lịch học!");
            await browser.close();
            return bot.sendMessage(chatId, "❌ Không tìm thấy lịch học. Vui lòng kiểm tra lại hệ thống.");
        }

        console.log("✅ Lấy dữ liệu lịch học thành công. Trả kết quả về Bot.");
        const lichHoc = await page.evaluate(() => {
            const ngayHoc = [];
            const monHocTheoNgay = {};

            const headers = document.querySelectorAll(".MuiTable-root thead tr th");
            headers.forEach((th, index) => {
                if (index > 0) {
                    ngayHoc.push(th.innerText.trim());
                    monHocTheoNgay[th.innerText.trim()] = [];
                }
            });

            const bodyRows = document.querySelectorAll(".MuiTable-root tbody tr");
            bodyRows.forEach((row) => {
                const columns = row.querySelectorAll("td");
                columns.forEach((col, colIndex) => {
                    if (colIndex > 0 && col.innerText.trim()) {
                        monHocTheoNgay[ngayHoc[colIndex - 1]].push(col.innerText.trim());
                    }
                });
            });

            return monHocTheoNgay;
        });

        await browser.close();

        if (Object.keys(lichHoc).length === 0) {
            bot.sendMessage(chatId, "❌ Không tìm thấy lịch học.");
        } else {
            let message = "📅 *Lịch học tuần này của bạn:*\n *------------------------------------* \n";
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

            bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        }
    } catch (error) {
        bot.sendMessage(chatId, "❌ Lỗi khi lấy lịch học: " + error.message);
        console.error(error);
        if (browser) await browser.close();
    }
});

// Dừng polling khi bot tắt
process.on("SIGINT", () => {
    console.log("🔴 Bot is shutting down...");
    bot.stopPolling().then(() => process.exit(0));
});

process.on("SIGTERM", () => {
    console.log("🔴 Bot is shutting down...");
    bot.stopPolling().then(() => process.exit(0));
});

console.log("🤖 Bot Telegram đang chạy...");
