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
    console.log("Received /start command from chat:", chatId);
    bot.sendMessage(chatId, "👋 Xin chào! Mình là Chatbot VHU. Luôn cập nhật thông tin nhanh nhất dành cho bạn <3\n" +
        "📅 Dùng /lichhoc để xem lịch học tuần này.\n" +
        "🔔 Dùng /thongbao để xem danh sách thông báo tuần này.");
});

// Lệnh /lichhoc
bot.onText(/\/lichhoc/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /lichhoc command from chat:", chatId);
    bot.sendMessage(chatId, "📡 Đang lấy thông tin lịch học tuần này, vui lòng chờ trong giây lát ⌛...");

    let browser;
    try {
        browser = anày, vui lòng chờ trong giây lát ⌛...");

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
        await page.waitForSelector("ul.MuiList-root", { timeout: 5000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Lấy danh sách thông báo
        const notifications = await page.evaluate(() => {
            const notificationItems = document.querySelectorAll("ul.MuiList-root li.MuiListItem-root");
            if (!notificationItems.length) return [];

            const result = [];
            notificationItems.forEach(item => {
                const textElement = item.querySelector("p.MuiTypography-root.MuiTypography-body2.MuiListItemText-secondary");
                if (textElement) {
                    const text = textElement.innerText.trim();
                    if (text) result.push(text);
                }
            });
            return result;
        });

        await browser.close();

        if (notifications.length === 0) {
            return bot.sendMessage(chatId, "🔔 Không lấy được chi tiết thông báo. Hãy thử lại.");
        }

        // Chỉ lấy 5 thông báo đầu tiên
        const limitedNotifications = notifications.slice(0, 5);

        // Format và gửi thông báo
        let message = "🔔 *Danh sách thông báo mới nhất:*\n *------------------------------------* \n";
        limitedNotifications.forEach((notif, index) => {
            message += `📢 *Thông báo ${index + 1}:*\n`;
            message += `📌 ${notif}\n\n`;
        });

        // Nếu có nhiều hơn 5 thông báo, thông báo cho người dùng
        if (notifications.length > 5) {
            message += `📢 Có thêm ${notifications.length - 5} thông báo khác. Vui lòng kiểm tra trực tiếp trên trang portal nếu cần!`;
        }

        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(chatId, "❌ Lỗi khi lấy thông báo: " + error.message);
        console.error(error);
        if (browser) await browser.close();
    }
});

console.log("🤖 Bot Telegram đang chạy...");
