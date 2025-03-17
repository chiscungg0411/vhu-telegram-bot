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

let browser = null;
let page = null;

// Chạy server và khởi tạo trình duyệt
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    const webhookUrl = `https://vhu-telegram-bot.onrender.com/bot${TOKEN}`;
    try {
        await bot.setWebHook(webhookUrl);
        console.log(`Webhook set to ${webhookUrl}`);

        // Khởi tạo trình duyệt và đăng nhập khi bot khởi động
        browser = await puppeteer.launch({
            headless: 'new',
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            timeout: 30000 // Giảm timeout từ 45 giây xuống 30 giây
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await loginToPortal(page);
        console.log("✅ Đăng nhập thành công, sẵn sàng xử lý lệnh!");
    } catch (error) {
        console.error("Lỗi khi khởi tạo trình duyệt hoặc đăng nhập:", error);
    }
});

// Hàm đăng nhập với cookie lưu trữ
async function loginToPortal(page) {
    const retry = async (fn, retries = 3, delay = 1000) => {
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
    await retry(() => page.goto("https://portal.vhu.edu.vn/login", { timeout: 30000, waitUntil: 'domcontentloaded' }));

    console.log("⏳ Chờ trang đăng nhập tải...");
    await page.waitForSelector("input[name='email']", { timeout: 5000 });
    await page.type("input[name='email']", process.env.VHU_EMAIL, { delay: 0 });
    await page.type("input[name='password']", process.env.VHU_PASSWORD, { delay: 0 });

    console.log("🔓 Nhấn nút đăng nhập...");
    await page.click("button[type='submit']");
    await retry(() => page.waitForNavigation({ timeout: 30000 }));

    // Lưu cookie để tái sử dụng
    const cookies = await page.cookies();
    await page.setCookie(...cookies);
}

// Hàm lấy lịch học theo tuần với tối ưu hóa
async function getSchedule(page, weekType) {
    console.log(`📅 Truy cập trang lịch học cho ${weekType}...`);
    await page.goto("https://portal.vhu.edu.vn/student/schedules", { timeout: 30000, waitUntil: 'domcontentloaded' });

    console.log("⏳ Chờ trang tải hoàn tất...");
    await page.waitForSelector(".MuiGrid-root", { timeout: 5000 });

    // Chọn năm học và học kỳ bằng cách sử dụng page.evaluate để giảm thời gian
    console.log("🔄 Chọn năm học và học kỳ...");
    const yearDropdownSelector = 'div[role="button"][id="demo-simple-select-helper"]';
    await page.waitForSelector(yearDropdownSelector, { timeout: 5000 });
    await page.click(yearDropdownSelector);
    await page.evaluate(() => {
        const yearOption = document.querySelector('li[data-value="2024-2025"]');
        if (yearOption) yearOption.click();
    });

    await new Promise(resolve => setTimeout(resolve, 300)); // Giảm từ 500ms xuống 300ms

    const dropdowns = await page.$$(yearDropdownSelector);
    if (dropdowns.length < 2) throw new Error("Không đủ dropdown (Năm học và Học kỳ).");
    await dropdowns[1].click();

    // Chọn học kỳ bằng page.evaluate để tránh lỗi cú pháp
    const semesterOptions = await page.evaluate(() => {
        const listbox = document.querySelector('ul[role="listbox"]');
        if (!listbox) return [];
        return Array.from(listbox.querySelectorAll('li')).map(option => ({
            text: option.innerText.trim(),
            value: option.getAttribute('data-value')
        }));
    });

    const semesterOption = semesterOptions.find(opt => opt.text === "Học kỳ 2");
    if (!semesterOption) throw new Error("Không tìm thấy 'Học kỳ 2'.");

    // Sửa lỗi cú pháp: Sử dụng page.evaluate để click trực tiếp
    await page.evaluate((value) => {
        const semesterOption = document.querySelector(`li[data-value="${value}"]`);
        if (semesterOption) semesterOption.click();
    }, semesterOption.value);

    // Chờ bảng lịch học
    console.log("⏳ Chờ bảng lịch học tải...");
    await page.waitForSelector(".MuiTable-root", { timeout: 5000 });

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

    if (!browser || !page) {
        console.log("❌ Trình duyệt hoặc trang không sẵn sàng, khởi tạo lại...");
        browser = await puppeteer.launch({
            headless: 'new',
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            timeout: 30000
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await loginToPortal(page);
    }

    try {
        const lichHoc = await getSchedule(page, "tuannay");

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
        if (browser) {
            await browser.close();
            browser = null;
            page = null;
        }
    }
});

bot.onText(/\/tuansau/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /tuansau command from chat:", chatId);
    bot.sendMessage(chatId, "📅 Đang lấy thông tin lịch học tuần sau, vui lòng chờ trong giây lát ⌛...");

    if (!browser || !page) {
        console.log("❌ Trình duyệt hoặc trang không sẵn sàng, khởi tạo lại...");
        browser = await puppeteer.launch({
            headless: 'new',
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            timeout: 30000
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await loginToPortal(page);
    }

    try {
        const lichHoc = await getSchedule(page, "tuansau");

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
        if (browser) {
            await browser.close();
            browser = null;
            page = null;
        }
    }
});

// Lệnh /thongbao
bot.onText(/\/thongbao/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /thongbao command from chat:", chatId);
    bot.sendMessage(chatId, "🔔 Đang lấy danh sách thông báo, vui lòng chờ trong giây lát ⌛...");

    if (!browser || !page) {
        console.log("❌ Trình duyệt hoặc trang không sẵn sàng, khởi tạo lại...");
        browser = await puppeteer.launch({
            headless: 'new',
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            timeout: 30000
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await loginToPortal(page);
    }

    try {
        await page.goto("https://portal.vhu.edu.vn/student/index", { timeout: 30000, waitUntil: 'domcontentloaded' });
        await page.waitForSelector("table.MuiTable-root", { timeout: 5000 });

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
        if (browser) {
            await browser.close();
            browser = null;
            page = null;
        }
    }
});

// Lệnh /congtac
bot.onText(/\/congtac/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /congtac command from chat:", chatId);
    bot.sendMessage(chatId, "📋 Đang lấy danh sách công tác xã hội, vui lòng chờ trong giây lát ⌛...");

    if (!browser || !page) {
        console.log("❌ Trình duyệt hoặc trang không sẵn sàng, khởi tạo lại...");
        browser = await puppeteer.launch({
            headless: 'new',
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            timeout: 30000
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        await loginToPortal(page);
    }

    try {
        await page.goto("https://portal.vhu.edu.vn/student/congtacxahoi", { timeout: 30000, waitUntil: 'domcontentloaded' });
        await page.waitForSelector(".MuiGrid-root", { timeout: 5000 });

        // Chọn năm học
        let yearDropdownSelector = 'div[role="button"][id="demo-simple-select-helper"]';
        await page.waitForSelector(yearDropdownSelector, { timeout: 5000 });
        await page.click(yearDropdownSelector);
        await page.evaluate(() => {
            const yearOption = document.querySelector('li[data-value="2024-2025"]');
            if (yearOption) yearOption.click();
        });
        await new Promise(resolve => setTimeout(resolve, 300));

        // Chọn học kỳ
        const dropdowns = await page.$$(yearDropdownSelector);
        if (dropdowns.length < 2) throw new Error("Không đủ dropdown (Năm học và Học kỳ).");
        await dropdowns[1].click();

        const semesterOptions = await page.evaluate(() => {
            const listbox = document.querySelector('ul[role="listbox"]');
            if (!listbox) return [];
            return Array.from(listbox.querySelectorAll('li')).map(option => ({
                text: option.innerText.trim(),
                value: option.getAttribute('data-value')
            }));
        });

        const semesterOption = semesterOptions.find(opt => opt.text === "Học kỳ 2");
        if (!semesterOption) throw new Error("Không tìm thấy 'Học kỳ 2'.");

        await page.evaluate((value) => {
            const semesterOption = document.querySelector(`li[data-value="${value}"]`);
            if (semesterOption) semesterOption.click();
        }, semesterOption.value);

        // Chờ bảng tải lại dữ liệu
        await page.waitForSelector("table.MuiTable-root tbody tr", { timeout: 5000 });

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
        if (browser) {
            await browser.close();
            browser = null;
            page = null;
        }
    }
});

console.log("🤖 Bot Telegram đang chạy...");
