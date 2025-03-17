require("dotenv").config();
const puppeteer = require("puppeteer");
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const app = express();

// Thêm middleware để parse JSON body
app.use(express.json());

// Webhook endpoint với xử lý lỗi linh hoạt hơn
app.post(`/bot${TOKEN}`, (req, res) => {
    const update = req.body;
    console.log("Received update:", JSON.stringify(update, null, 2)); // Log chi tiết dữ liệu update
    // Kiểm tra xem update có tồn tại không
    if (!update) {
        console.error("Dữ liệu update không tồn tại:", update);
        // Vẫn trả về 200 để Telegram không ngừng gửi update
        return res.sendStatus(200);
    }
    try {
        bot.processUpdate(update);
        res.sendStatus(200);
    } catch (error) {
        console.error("Lỗi khi xử lý update:", error);
        res.sendStatus(200); // Trả về 200 ngay cả khi có lỗi để Telegram tiếp tục gửi update
    }
});

// Ping endpoint để giữ bot sống
app.get("/ping", (req, res) => {
    res.send("Bot is alive!");
});

// Khởi tạo bot
const bot = new TelegramBot(TOKEN);

// Chạy server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    const webhookUrl = `https://vhu-telegram-bot.onrender.com/bot${TOKEN}`;
    try {
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to ${webhookUrl}`);
    } catch (error) {
        console.error("Lỗi khi thiết lập Webhook:", error);
    }
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

    // Tăng thời gian chờ để trang tải hoàn tất
    console.log("⏳ Chờ trang đăng nhập tải...");
    await new Promise(resolve => setTimeout(resolve, 7000));

    console.log("🔍 Kiểm tra input email...");
    const emailExists = await page.evaluate(() => {
        const emailInput = document.querySelector("input[name='email']") || document.querySelector("input[type='email']");
        console.log("HTML của ô email:", emailInput ? emailInput.outerHTML : "Không tìm thấy");
        return !!emailInput;
    });
    if (!emailExists) {
        throw new Error("Không tìm thấy ô nhập email! Vui lòng kiểm tra lại selector hoặc cấu trúc trang.");
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

// Hàm lấy lịch học theo tuần
async function getSchedule(page, weekType) {
    console.log(`📅 Truy cập trang lịch học cho ${weekType}...`);
    await page.goto("https://portal.vhu.edu.vn/student/schedules", { timeout: 120000 });

    console.log("⏳ Chờ trang tải hoàn tất...");
    await new Promise(resolve => setTimeout(resolve, 8300));

    // Giả định có bộ chọn tuần (cần điều chỉnh dựa trên HTML thực tế)
    if (weekType === "tuansau") {
        console.log("🔄 Chuyển đến lịch tuần sau...");
        // Thêm logic chuyển tuần (ví dụ: click nút "Next Week")
        // Hiện tại giả định, bạn cần cung cấp selector của nút "Next Week" nếu có
        await page.click(".next-week-button-selector").catch(() => console.log("Không tìm thấy nút chuyển tuần, sử dụng tuần hiện tại."));
    }

    console.log("📜 Kiểm tra dữ liệu lịch học...");
    const tableExists = await page.evaluate(() => !!document.querySelector(".MuiTable-root"));
    if (!tableExists) {
        console.error("❌ Không tìm thấy bảng lịch học!");
        throw new Error("Không tìm thấy bảng lịch học!");
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

    return lichHoc;
}

// Lệnh /lichhoc
bot.onText(/\/lichhoc(?:\s+(tuầnnày|tuansau))?/i, async (msg, match) => {
    const chatId = msg.chat.id;
    console.log("Received /lichhoc command from chat:", chatId);
    const weekType = match[1] ? match[1].toLowerCase() : "tuầnnày";
    bot.sendMessage(chatId, `📡 Đang lấy thông tin lịch học ${weekType === "tuansau" ? "tuần sau" : "tuần này"}, vui lòng chờ trong giây lát ⌛...`);

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await loginToPortal(page);

        const lichHoc = await getSchedule(page, weekType);

        await browser.close();

        if (Object.keys(lichHoc).length === 0) {
            bot.sendMessage(chatId, `❌ Không tìm thấy lịch học ${weekType === "tuansau" ? "tuần sau" : "tuần này"}.`);
        } else {
            let message = `📅 *Lịch học ${weekType === "tuansau" ? "tuần sau" : "tuần này"} của bạn:*\n *------------------------------------* \n`;
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
        bot.sendMessage(chatId, `❌ Lỗi khi lấy lịch học ${weekType === "tuansau" ? "tuần sau" : "tuần này"}: ${error.message}`);
        console.error(error);
        if (browser) await browser.close();
    }
});

// Lệnh /thongbao (chỉ lấy 5 thông báo đầu tiên từ bảng)
bot.onText(/\/thongbao/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /thongbao command from chat:", chatId);
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

        // Truy cập trang thông báo
        console.log("📬 Truy cập trang thông báo...");
        await page.goto("https://portal.vhu.edu.vn/student/index", { timeout: 120000 });

        console.log("⏳ Chờ trang tải hoàn tất...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Kiểm tra bảng thông báo
        console.log("🔍 Kiểm tra bảng thông báo...");
        const tableExists = await page.evaluate(() => !!document.querySelector("table.MuiTable-root"));
        if (!tableExists) {
            console.error("❌ Không tìm thấy bảng thông báo!");
            await browser.close();
            return bot.sendMessage(chatId, "❌ Không tìm thấy bảng thông báo. Vui lòng kiểm tra lại hệ thống.");
        }

        // Lấy danh sách thông báo
        const notifications = await page.evaluate(() => {
            const notificationItems = document.querySelectorAll("table.MuiTable-root tbody tr");
            if (!notificationItems.length) return [];

            const result = [];
            notificationItems.forEach(row => {
                const titleElement = row.querySelector("td a.css-1qeq5on");
                const senderElement = row.querySelector("td:nth-child(2)");
                const dateElement = row.querySelector("td:nth-child(3)");
                if (titleElement && senderElement && dateElement) {
                    const title = titleElement.innerText.trim();
                    const sender = senderElement.innerText.trim();
                    const date = dateElement.innerText.trim();
                    if (title) result.push({ title, sender, date });
                }
            });
            return result;
        });

        await browser.close();

        if (notifications.length === 0) {
            return bot.sendMessage(chatId, "🔔 Không lấy được chi tiết thông báo. Có thể cấu trúc trang đã thay đổi.");
        }

        // Chỉ lấy 5 thông báo đầu tiên
        const limitedNotifications = notifications.slice(0, 5);

        // Format và gửi thông báo
        let message = "🔔 *Danh sách 5 thông báo mới nhất:*\n *------------------------------------* \n";
        limitedNotifications.forEach((notif, index) => {
            message += `📢 *Thông báo ${index + 1}:*\n`;
            message += `📌 *Tiêu đề:* ${notif.title}\n`;
            message += `📩 *Người gửi:* ${notif.sender}\n`;
            message += `⏰ *Thời gian:* ${notif.date}\n\n`;
        });

        // Nếu có nhiều hơn 5 thông báo, thông báo cho người dùng với hyperlink
        if (notifications.length > 5) {
            message += `📢 Có thêm *${notifications.length - 5} thông báo khác*. Vui lòng kiểm tra trực tiếp trên [trang portal](https://portal.vhu.edu.vn/login) nếu cần!`;
        }

        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(chatId, "❌ Lỗi khi lấy thông báo: " + error.message);
        console.error(error);
        if (browser) await browser.close();
    }
});

console.log("🤖 Bot Telegram đang chạy...");
