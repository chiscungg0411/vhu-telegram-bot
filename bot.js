require("dotenv").config();
const puppeteer = require("puppeteer");
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const app = express();
const bot = new TelegramBot(TOKEN);

// Webhook endpoint với kiểm tra lỗi
app.post(`/bot${TOKEN}`, (req, res) => {
    const update = req.body;
    // Kiểm tra xem update có hợp lệ không
    if (!update || (!update.message && !update.callback_query && !update.inline_query)) {
        console.error("Dữ liệu update không hợp lệ:", update);
        return res.sendStatus(400); // Trả về lỗi nếu update không hợp lệ
    }
    try {
        bot.processUpdate(update);
        res.sendStatus(200);
    } catch (error) {
        console.error("Lỗi khi xử lý update:", error);
        res.sendStatus(500);
    }
});

// Ping endpoint để giữ bot sống
app.get("/ping", (req, res) => {
    res.send("Bot is alive!");
});

// Chạy server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    const webhookUrl = `https://vhu-telegram-bot.onrender.com/bot${TOKEN}`; // Thay bằng URL thật của bạn
    await bot.setWebHook(webhookUrl);
    console.log(`Webhook set to ${webhookUrl}`);
});

// Hàm đăng nhập tái sử dụng
async function loginToPortal(page) {
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
        throw new Error("Không tìm thấy ô nhập email!");
    }

    console.log("📩 Nhập tài khoản...");
    await page.type("input[name='email']", process.env.VHU_EMAIL, { delay: 100 });

    console.log("🔒 Nhập mật khẩu...");
    await page.type("input[name='password']", process.env.VHU_PASSWORD, { delay: 100 });

    console.log("🔓 Nhấn nút đăng nhập...");
    await page.click("button[type='submit']");

    console.log("⌛ Đang đăng nhập...");
    await retry(() => page.waitForNavigation({ timeout: 120000 }));
}

// Lệnh /start để kiểm tra bot
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "👋 Chào bạn! Mình là bot lấy lịch học và thông báo.\n" +
        "📅 Dùng /lichhoc để xem lịch học tuần này.\n" +
        "🔔 Dùng /thongbao để xem danh sách thông báo.");
});

// Lệnh /lichhoc
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

        await loginToPortal(page);

        console.log("📅 Truy cập trang lịch học...");
        await page.goto("https://portal.vhu.edu.vn/student/schedules", { timeout: 120000 });

        console.log("⏳ Chờ trang tải hoàn tất...");
        await new Promise(resolve => setTimeout(resolve, 8300));

        console.log("📜 Kiểm tra dữ liệu lịch học...");
        const tableExists = await page.evaluate(() => !!document.querySelector(".MuiTable-root"));
        if (!tableExists) {
            console.error("❌ Không tìm thấy bảng lịch học!");
            await browser.close();
            return bot.sendMessage(chatId, "❌ Không tìm thấy lịch học. Vui lòng kiểm tra lại hệ thống.");
        }

        console.log("✅ Lấy dữ liệu lịch học thành công.");
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

// Lệnh /thongbao (phiên bản đơn giản, chỉ lấy từ dropdown)
bot.onText(/\/thongbao/, async (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "🔔 Đang lấy thông báo, vui lòng chờ trong giây lát ⌛...");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Đăng nhập
        await loginToPortal(page);

        // Truy cập trang student
        console.log("📬 Truy cập trang thông báo...");
        await page.goto("https://portal.vhu.edu.vn/student", { timeout: 120000 });

        console.log("⏳ Chờ trang tải hoàn tất...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Kiểm tra nút thông báo
        console.log("🔍 Kiểm tra nút thông báo...");
        const notificationButtonExists = await page.evaluate(() => !!document.querySelector("button.MuiIconButton-root[aria-label='Notifications']"));
        if (!notificationButtonExists) {
            console.error("❌ Không tìm thấy nút thông báo!");
            await browser.close();
            return bot.sendMessage(chatId, "❌ Không tìm thấy nút thông báo. Vui lòng kiểm tra lại hệ thống.");
        }

        // Lấy số lượng thông báo
        const notificationCount = await page.evaluate(() => {
            const badge = document.querySelector("span.MuiBadge-badge");
            return badge ? parseInt(badge.innerText) : 0;
        });
        console.log(`🔔 Số lượng thông báo: ${notificationCount}`);

        if (notificationCount === 0) {
            await browser.close();
            return bot.sendMessage(chatId, "🔔 Hiện tại không có thông báo nào.");
        }

        // Nhấn nút chuông để mở dropdown
        console.log("🔔 Nhấn nút thông báo...");
        await page.click("button.MuiIconButton-root[aria-label='Notifications']");

        // Chờ dropdown hiển thị
        console.log("⏳ Chờ dropdown thông báo hiển thị...");
        await page.waitForSelector("div[role='menuitem']", { timeout: 5000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Lấy danh sách thông báo
        const notifications = await page.evaluate(() => {
            const notificationItems = document.querySelectorAll("div[role='menuitem']");
            if (!notificationItems.length) return [];

            const result = [];
            notificationItems.forEach(item => {
                const text = item.innerText.trim();
                if (text) result.push(text);
            });
            return result;
        });

        await browser.close();

        if (notifications.length === 0) {
            return bot.sendMessage(chatId, "🔔 Không lấy được chi tiết thông báo. Có thể cấu trúc trang đã thay đổi.");
        }

        // Format và gửi thông báo
        let message = "🔔 *Danh sách thông báo:*\n *------------------------------------* \n";
        notifications.forEach((notif, index) => {
            message += `📢 *Thông báo ${index + 1}:*\n`;
            message += `📌 ${notif}\n\n`;
        });

        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(chatId, "❌ Lỗi khi lấy thông báo: " + error.message);
        console.error(error);
        if (browser) await browser.close();
    }
});

console.log("🤖 Bot Telegram đang chạy...");
