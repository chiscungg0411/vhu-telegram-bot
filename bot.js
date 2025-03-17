require("dotenv").config();
const puppeteer = require("puppeteer");
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const app = express();

// Middleware để parse JSON body
app.use(express.json());

// Webhook endpoint với xử lý lỗi linh hoạt hơn
app.post(`/bot${TOKEN}`, (req, res) => {
    const update = req.body;
    console.log("Received update:", JSON.stringify(update, null, 2));
    if (!update) {
        console.error("Dữ liệu update không tồn tại:", update);
        return res.sendStatus(200);
    }
    try {
        bot.processUpdate(update);
        res.sendStatus(200);
    } catch (error) {
        console.error("Lỗi khi xử lý update:", error);
        res.sendStatus(200);
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

// Hàm đăng nhập tái sử dụng với thời gian chờ tối ưu
async function loginToPortal(page) {
    const retry = async (fn, retries = 3, delay = 2000) => { // Giảm delay từ 5000ms xuống 2000ms
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
    await retry(() => page.goto("https://portal.vhu.edu.vn/login", { timeout: 60000, waitUntil: 'domcontentloaded' })); // Giảm timeout từ 120000ms xuống 60000ms, dùng 'domcontentloaded' thay vì 'networkidle2'

    // Kiểm tra URL hiện tại sau khi truy cập
    const currentUrl = page.url();
    console.log("🌐 URL hiện tại sau khi truy cập:", currentUrl);
    if (!currentUrl.includes("login")) {
        throw new Error("Không ở trang đăng nhập! Có thể đã bị chuyển hướng hoặc trang không tải đúng.");
    }

    console.log("⏳ Chờ trang đăng nhập tải...");
    let emailSelector;
    try {
        await page.waitForSelector("input[name='email']", { timeout: 5000 }); // Giảm timeout từ 15000ms xuống 5000ms
        emailSelector = "input[name='email']";
    } catch (error) {
        console.log("❌ Không tìm thấy input[name='email'], thử selector khác...");
        try {
            await page.waitForSelector("input[type='email']", { timeout: 3000 }); // Giảm timeout từ 5000ms xuống 3000ms
            emailSelector = "input[type='email']";
        } catch (error) {
            console.log("❌ Không tìm thấy input[type='email'], thử selector khác...");
            try {
                await page.waitForSelector("input[name='username']", { timeout: 3000 }); // Giảm timeout từ 5000ms xuống 3000ms
                emailSelector = "input[name='username']";
            } catch (error) {
                throw new Error("Không tìm thấy ô nhập email! Có thể selector đã thay đổi.");
            }
        }
    }

    console.log("📩 Nhập tài khoản...");
    await page.type(emailSelector, process.env.VHU_EMAIL, { delay: 50 }); // Giảm delay từ 100ms xuống 50ms

    console.log("🔒 Nhập mật khẩu...");
    let passwordSelector;
    try {
        await page.waitForSelector("input[name='password']", { timeout: 3000 }); // Giảm timeout từ 5000ms xuống 3000ms
        passwordSelector = "input[name='password']";
    } catch (error) {
        console.log("❌ Không tìm thấy input[name='password'], thử selector khác...");
        try {
            await page.waitForSelector("input[type='password']", { timeout: 3000 }); // Giảm timeout từ 5000ms xuống 3000ms
            passwordSelector = "input[type='password']";
        } catch (error) {
            throw new Error("Không tìm thấy ô nhập mật khẩu! Có thể selector đã thay đổi.");
        }
    }

    await page.type(passwordSelector, process.env.VHU_PASSWORD, { delay: 50 }); // Giảm delay từ 100ms xuống 50ms

    console.log("🔓 Nhấn nút đăng nhập...");
    await page.click("button[type='submit']");

    console.log("⌛ Đang đăng nhập...");
    await retry(() => page.waitForNavigation({ timeout: 60000 })); // Giảm timeout từ 120000ms xuống 60000ms

    // Kiểm tra xem có đăng nhập thành công không
    const isLoggedIn = await page.evaluate(() => {
        return !document.querySelector("input[name='email']") && !document.querySelector("input[type='email']") && !document.querySelector("input[name='username']");
    });
    if (!isLoggedIn) {
        throw new Error("Đăng nhập thất bại! Vui lòng kiểm tra email và mật khẩu hoặc xem log để kiểm tra CAPTCHA.");
    }
}

// Hàm lấy lịch học theo tuần với thời gian chờ tối ưu
async function getSchedule(page, weekType) {
    console.log(`📅 Truy cập trang lịch học cho ${weekType}...`);
    await page.goto("https://portal.vhu.edu.vn/student/schedules", { timeout: 60000, waitUntil: 'domcontentloaded' }); // Giảm timeout từ 120000ms xuống 60000ms

    // Kiểm tra URL
    const currentUrl = page.url();
    if (!currentUrl.includes("schedules")) {
        throw new Error("Không ở trang lịch học! Có thể bị chuyển hướng.");
    }

    // Chờ trang tải
    console.log("⏳ Chờ trang tải hoàn tất...");
    await page.waitForSelector(".MuiGrid-root", { timeout: 15000 }); // Giảm timeout từ 30000ms xuống 15000ms

    // Chọn năm học và học kỳ
    console.log("🔄 Chọn năm học và học kỳ...");
    try {
        const yearDropdownSelector = 'div[role="button"][id="demo-simple-select-helper"]';
        await page.waitForSelector(yearDropdownSelector, { timeout: 5000 }); // Giảm timeout từ 10000ms xuống 5000ms
        await page.click(yearDropdownSelector);

        await page.waitForSelector('ul[role="listbox"]', { timeout: 3000 }); // Giảm timeout từ 5000ms xuống 3000ms
        await page.click('li[data-value="2024-2025"]');

        await new Promise(resolve => setTimeout(resolve, 500)); // Giảm từ 1000ms xuống 500ms

        const dropdowns = await page.$$(yearDropdownSelector);
        if (dropdowns.length < 2) throw new Error("Không đủ dropdown (Năm học và Học kỳ).");
        await dropdowns[1].click(); // Chọn học kỳ

        await page.waitForSelector('ul[role="listbox"]', { timeout: 3000 }); // Giảm timeout từ 5000ms xuống 3000ms
        const semesterOptions = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('ul[role="listbox"] li')).map(option => ({
                text: option.innerText.trim(),
                value: option.getAttribute('data-value')
            }));
        });
        const semesterOption = semesterOptions.find(opt => opt.text === "Học kỳ 2");
        if (!semesterOption) throw new Error("Không tìm thấy 'Học kỳ 2'.");
        await page.click(`li[data-value="${semesterOption.value}"]`);
    } catch (error) {
        console.log("❌ Lỗi khi chọn năm học/học kỳ:", error.message);
    }

    // Chờ bảng lịch học
    let tableLoaded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            await page.waitForSelector(".MuiTable-root", { timeout: 15000 }); // Giảm timeout từ 30000ms xuống 15000ms
            tableLoaded = true;
            break;
        } catch (error) {
            console.log(`❌ Thử lần ${attempt + 1}: Không tìm thấy bảng sau 15 giây.`);
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2000)); // Giảm từ 5000ms xuống 2000ms
        }
    }

    if (!tableLoaded) {
        throw new Error("Không thể tìm thấy bảng lịch học sau nhiều lần thử.");
    }

    // Lấy dữ liệu lịch học
    console.log("✅ Lấy dữ liệu lịch học...");
    const lichHoc = await page.evaluate(() => {
        const monHocTheoNgay = {};
        const headers = document.querySelectorAll(".MuiTable-root thead th");
        headers.forEach((th, index) => {
            if (index > 0) monHocTheoNgay[th.innerText.trim()] = [];
        });

        const rows = document.querySelectorAll(".MuiTable-root tbody tr");
        rows.forEach(row => {
            const cells = row.querySelectorAll("td");
            cells.forEach((cell, index) => {
                if (index > 0 && cell.innerText.trim()) {
                    const ngay = headers[index].innerText.trim();
                    const monHoc = cell.innerText.trim().split("\n").join(" - ");
                    monHocTheoNgay[ngay].push(monHoc);
                }
            });
        });

        return monHocTheoNgay;
    });

    return lichHoc;
}

// Lệnh /start để kiểm tra bot
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /start command from chat:", chatId);
    bot.sendMessage(chatId, "👋 Xin chào! Mình là Trợ lý VHU, người luôn cập nhật thông tin nhanh nhất cho bạn <3.\n" +
        "📅 Dùng /tuannay để xem lịch học tuần này.\n" +
        "📅 Dùng /tuansau để xem lịch học tuần sau.\n" +
        "🔔 Dùng /thongbao để xem danh sách thông báo.\n" +
        "📋 Dùng /congtac để xem danh sách công tác xã hội.\n\n" +
        "💡 *Mẹo:* Nhấn vào nút menu 📋 (gần ô nhập tin nhắn) để chọn lệnh nhanh!");
});

// Lệnh /tuannay và /tuansau
bot.onText(/\/tuannay/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /tuannay command from chat:", chatId);
    bot.sendMessage(chatId, "📅 Đang lấy thông tin lịch học tuần này, vui lòng chờ trong giây lát ⌛...");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await loginToPortal(page);
        const lichHoc = await getSchedule(page, "tuannay");

        await browser.close();

        if (Object.keys(lichHoc).length === 0) {
            bot.sendMessage(chatId, "❌ Không tìm thấy lịch học tuần này.");
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
        bot.sendMessage(chatId, "❌ Lỗi khi lấy lịch học tuần này: " + error.message);
        console.error(error);
        if (browser) await browser.close();
    }
});

bot.onText(/\/tuansau/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /tuansau command from chat:", chatId);
    bot.sendMessage(chatId, "📅 Đang lấy thông tin lịch học tuần sau, vui lòng chờ trong giây lát ⌛...");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await loginToPortal(page);
        const lichHoc = await getSchedule(page, "tuansau");

        await browser.close();

        if (Object.keys(lichHoc).length === 0) {
            bot.sendMessage(chatId, "❌ Không tìm thấy lịch học tuần sau.");
        } else {
            let message = "📅 *Lịch học tuần sau của bạn:*\n *------------------------------------* \n";
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
        bot.sendMessage(chatId, "❌ Lỗi khi lấy lịch học tuần sau: " + error.message);
        console.error(error);
        if (browser) await browser.close();
    }
});

// Lệnh /thongbao
bot.onText(/\/thongbao/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /thongbao command from chat:", chatId);
    bot.sendMessage(chatId, "🔔 Đang lấy danh sách thông báo, vui lòng chờ trong giây lát ⌛...");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await loginToPortal(page);

        console.log("📬 Truy cập trang thông báo...");
        await page.goto("https://portal.vhu.edu.vn/student/index", { timeout: 60000, waitUntil: 'domcontentloaded' }); // Giảm timeout từ 120000ms xuống 60000ms

        console.log("⏳ Chờ trang tải hoàn tất...");
        let tableLoaded = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await page.waitForSelector("table.MuiTable-root", { timeout: 10000 }); // Giảm timeout từ 15000ms xuống 10000ms
                tableLoaded = true;
                break;
            } catch (error) {
                console.log(`❌ Thử lần ${attempt + 1}: Không tìm thấy selector sau 10 giây.`);
                if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000)); // Giảm từ 2000ms xuống 1000ms
            }
        }

        if (!tableLoaded) {
            return bot.sendMessage(chatId, "❌ Không tìm thấy bảng thông báo sau nhiều lần thử.");
        }

        console.log("🔍 Kiểm tra bảng thông báo...");
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
            return bot.sendMessage(chatId, "🔔 Không lấy được chi tiết thông báo.");
        }

        const limitedNotifications = notifications.slice(0, 5);
        let message = "🔔 *Danh sách thông báo mới nhất:*\n *------------------------------------* \n";
        limitedNotifications.forEach((notif, index) => {
            message += `📢 *Thông báo ${index + 1}:*\n`;
            message += `📌 *Tiêu đề:* ${notif.title}\n`;
            message += `📩 *Người gửi:* ${notif.sender}\n`;
            message += `⏰ *Thời gian:* ${notif.date}\n\n`;
        });

        if (notifications.length > 5) {
            message += `📢 Có thêm *${notifications.length - 5} thông báo khác*. Vui lòng kiểm tra trực tiếp trên [trang portal](https://portal.vhu.edu.vn/student/index) nếu cần!`;
        }

        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(chatId, "❌ Lỗi khi lấy thông báo: " + error.message);
        console.error(error);
        if (browser) await browser.close();
    }
});

// Lệnh /congtac
bot.onText(/\/congtac/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /congtac command from chat:", chatId);
    bot.sendMessage(chatId, "📋 Đang lấy danh sách công tác xã hội, vui lòng chờ trong giây lát ⌛...");

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await loginToPortal(page);

        console.log("📋 Truy cập trang công tác xã hội...");
        await page.goto("https://portal.vhu.edu.vn/student/congtacxahoi", { timeout: 60000, waitUntil: 'domcontentloaded' }); // Giảm timeout từ 120000ms xuống 60000ms

        console.log("⏳ Chờ trang tải hoàn tất...");
        await page.waitForSelector(".MuiGrid-root", { timeout: 10000 }); // Giảm timeout từ 15000ms xuống 10000ms

        // Chọn năm học
        console.log("🔄 Mở dropdown năm học...");
        let yearDropdownSelector = 'div[role="button"][id="demo-simple-select-helper"]';
        await page.waitForSelector(yearDropdownSelector, { timeout: 5000 }); // Giảm timeout từ 10000ms xuống 5000ms
        await page.click(yearDropdownSelector);

        console.log("⏳ Chờ danh sách tùy chọn năm học...");
        await page.waitForSelector('ul[role="listbox"]', { timeout: 3000 }); // Giảm timeout từ 5000ms xuống 3000ms
        await page.click('li[data-value="2024-2025"]');

        await new Promise(resolve => setTimeout(resolve, 500)); // Giảm từ 1000ms xuống 500ms

        // Chọn học kỳ
        console.log("🔄 Mở dropdown học kỳ...");
        const dropdowns = await page.$$(yearDropdownSelector);
        if (dropdowns.length < 2) throw new Error("Không đủ dropdown (Năm học và Học kỳ).");
        await dropdowns[1].click();

        console.log("⏳ Chờ danh sách tùy chọn học kỳ...");
        await page.waitForSelector('ul[role="listbox"]', { timeout: 3000 }); // Giảm timeout từ 5000ms xuống 3000ms
        const semesterOptions = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('ul[role="listbox"] li')).map(option => ({
                text: option.innerText.trim(),
                value: option.getAttribute('data-value')
            }));
        });
        const semesterOption = semesterOptions.find(opt => opt.text === "Học kỳ 2");
        if (!semesterOption) throw new Error("Không tìm thấy 'Học kỳ 2'.");
        await page.click(`li[data-value="${semesterOption.value}"]`);

        // Chờ bảng tải lại dữ liệu
        console.log("⏳ Chờ bảng công tác xã hội tải lại...");
        let tableLoaded = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await page.waitForSelector("table.MuiTable-root tbody tr", { timeout: 10000 }); // Giảm timeout từ 15000ms xuống 10000ms
                tableLoaded = true;
                break;
            } catch (error) {
                console.log(`❌ Thử lần ${attempt + 1}: Không tìm thấy bảng sau 10 giây.`);
                if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000)); // Giảm từ 2000ms xuống 1000ms
            }
        }

        if (!tableLoaded) {
            throw new Error("Không tìm thấy bảng công tác xã hội sau nhiều lần thử.");
        }

        console.log("🔍 Kiểm tra bảng công tác xã hội...");
        const congTacData = await page.evaluate(() => {
            const rows = document.querySelectorAll("table.MuiTable-root tbody tr");
            if (!rows.length) return [];
            const result = [];
            rows.forEach(row => {
                const columns = row.querySelectorAll("td");
                if (columns.length >= 7) {
                    const suKien = columns[1]?.innerText.trim() || "Không có thông tin";
                    const diaDiem = columns[2]?.innerText.trim() || "Không có thông tin";
                    const soLuongDK = columns[3]?.innerText.trim() || "Không có thông tin";
                    const diem = columns[4]?.innerText.trim() || "Không có thông tin";
                    const batDau = columns[5]?.innerText.trim() || "Không có thông tin";
                    const ketThuc = columns[6]?.innerText.trim() || "Chưa có";
                    result.push({ suKien, diaDiem, soLuongDK, diem, batDau, ketThuc });
                }
            });
            return result;
        });

        await browser.close();

        if (congTacData.length === 0) {
            return bot.sendMessage(chatId, "📋 Không có công tác xã hội nào được tìm thấy.");
        }

        const limitedCongTacData = congTacData.slice(0, 5);
        let message = "📋 *Danh sách công tác xã hội:*\n *------------------------------------* \n";
        limitedCongTacData.forEach((item, index) => {
            message += `📌 *Công tác ${index + 1}:*\n`;
            message += `📅 *Sự kiện:* ${item.suKien}\n`;
            message += `📍 *Địa điểm:* ${item.diaDiem}\n`;
            message += `👥 *Số lượng đăng ký:* ${item.soLuongDK}\n`;
            message += `⭐ *Điểm:* ${item.diem}\n`;
            message += `🕛 *Bắt đầu:* ${item.batDau}\n`;
            message += `🕧 *Kết thúc:* ${item.ketThuc}\n\n`;
        });

        if (congTacData.length > 5) {
            message += `📢 Có thêm *${congTacData.length - 5} công tác khác*. Vui lòng kiểm tra trực tiếp trên [trang portal](https://portal.vhu.edu.vn/congtacxahoi)!`;
        }

        bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    } catch (error) {
        bot.sendMessage(chatId, "❌ Lỗi khi lấy công tác xã hội: " + error.message);
        console.error(error);
        if (browser) await browser.close();
    }
});

console.log("🤖 Bot Telegram đang chạy...");
