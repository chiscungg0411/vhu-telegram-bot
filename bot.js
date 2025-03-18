require("dotenv").config();
const puppeteer = require("puppeteer");
const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

// Kiểm tra xem các module có được tải không
if (!puppeteer || !TelegramBot || !express) {
    console.error("❌ Một hoặc nhiều thư viện (puppeteer, node-telegram-bot-api, express) không được cài đặt. Vui lòng kiểm tra Dockerfile.");
    process.exit(1);
}

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

// Khởi tạo trình duyệt toàn cục
let browser;
async function initializeBrowser() {
    try {
        console.log("🔄 Đang khởi tạo trình duyệt Puppeteer...");
        browser = await puppeteer.launch({
            headless: 'new',
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            executablePath: '/usr/bin/google-chrome-stable',
            timeout: 15000,
        });
        console.log("✅ Trình duyệt Puppeteer đã được khởi tạo với /usr/bin/google-chrome-stable.");
    } catch (error) {
        console.error("❌ Lỗi khởi tạo Puppeteer với đường dẫn mặc định:", error.message);
        console.log("🔄 Thử tìm Chrome tự động...");
        try {
            browser = await puppeteer.launch({
                headless: 'new',
                args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
                timeout: 15000,
            });
            console.log("✅ Trình duyệt Puppeteer đã được khởi tạo với phát hiện tự động.");
        } catch (fallbackError) {
            console.error("❌ Lỗi khởi tạo Puppeteer (fallback):", fallbackError.message);
            throw new Error("Không thể khởi tạo trình duyệt Puppeteer.");
        }
    }
}

// Đóng trình duyệt khi bot dừng
process.on('SIGINT', async () => {
    if (browser) {
        await browser.close();
        console.log("✅ Trình duyệt Puppeteer đã được đóng.");
    }
    process.exit();
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    const webhookUrl = `https://vhu-telegram-bot.onrender.com/bot${TOKEN}`;
    try {
        await bot.setWebHook(webhookUrl);
        console.log(`✅ Webhook set to ${webhookUrl}`);
    } catch (error) {
        console.error("❌ Lỗi khi thiết lập Webhook:", error.message);
        console.log("🔄 Chuyển sang chế độ polling...");
        bot.startPolling({ polling: true });
        console.log("✅ Đã chuyển sang chế độ polling.");
    }

    // Khởi tạo trình duyệt khi server khởi động
    try {
        await initializeBrowser();
    } catch (error) {
        console.error("❌ Không thể khởi tạo trình duyệt khi server khởi động:", error.message);
        process.exit(1);
    }
});

// Hàm đăng nhập với tối ưu hóa
async function loginToPortal(page) {
    const startTime = Date.now();
    console.log("🔄 Bắt đầu đăng nhập...", startTime);

    const retry = async (fn, retries = 2, delay = 1000) => {
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

    // Chặn tải hình ảnh và tài nguyên không cần thiết để tăng tốc độ
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await retry(() => page.goto("https://portal.vhu.edu.vn/login", { timeout: 10000, waitUntil: 'domcontentloaded' }), 2, 1000);

    await page.waitForSelector("input[name='email']", { timeout: 5000 });
    await page.type("input[name='email']", process.env.VHU_EMAIL, { delay: 0 });
    await page.type("input[name='password']", process.env.VHU_PASSWORD, { delay: 0 });

    await page.click("button[type='submit']");
    await retry(() => page.waitForNavigation({ timeout: 10000 }), 2, 1000);

    console.log("✅ Đăng nhập thành công, thời gian:", Date.now() - startTime, "ms");
}

// Hàm lấy lịch học với tối ưu hóa
async function getSchedule(page, weekOffset = 0) {
    const startTime = Date.now();
    console.log("📅 Bắt đầu lấy lịch học...", startTime);

    await page.goto("https://portal.vhu.edu.vn/student/schedules", { timeout: 10000, waitUntil: 'domcontentloaded' });
    await page.waitForSelector(".MuiGrid-root", { timeout: 5000 });

    const yearDropdownSelector = 'div[role="button"][id="demo-simple-select-helper"]';
    await page.waitForSelector(yearDropdownSelector, { timeout: 5000 });
    await page.click(yearDropdownSelector);
    await page.evaluate(() => {
        const yearOption = document.querySelector('li[data-value="2024-2025"]');
        if (yearOption) yearOption.click();
    });

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

    await page.waitForSelector(".MuiTable-root", { timeout: 5000 });

    const lichHoc = await page.evaluate((weekOffset) => {
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
    }, weekOffset);

    console.log("✅ Lấy lịch học thành công, thời gian:", Date.now() - startTime, "ms");
    return lichHoc;
}

// Lệnh /start
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

// Lệnh /tuannay
bot.onText(/\/tuannay/, async (msg) => {
    const chatId = msg.chat.id;
    console.log(`Received /tuannay command from chat: ${chatId} at ${new Date().toISOString()}`);
    try {
        bot.sendMessage(chatId, "📅 Đang lấy thông tin lịch học tuần này, vui lòng chờ trong giây lát ⌛...");

        let page;
        try {
            if (!browser) {
                console.log("Browser not initialized, reinitializing...");
                await initializeBrowser();
            }
            page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720 });

            await loginToPortal(page);
            const lichHoc = await getSchedule(page, 0);

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
            console.error(`❌ Lỗi khi xử lý lệnh /tuannay cho chat ${chatId}:`, error.message);
            bot.sendMessage(chatId, `❌ Lỗi khi lấy lịch học tuần này: ${error.message} (Thời gian tối đa 1 phút)`);
        } finally {
            if (page) {
                await page.close();
                console.log(`Page closed for chat ${chatId}`);
            }
        }
    } catch (error) {
        console.error(`❌ Lỗi ngoài cùng khi xử lý /tuannay cho chat ${chatId}:`, error.message);
        bot.sendMessage(chatId, `❌ Đã xảy ra lỗi không mong muốn: ${error.message}`);
    }
});

// Lệnh /tuansau
bot.onText(/\/tuansau/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /tuansau command from chat:", chatId);
    bot.sendMessage(chatId, "📅 Đang lấy thông tin lịch học tuần sau, vui lòng chờ trong giây lát ⌛...");

    let page;
    try {
        if (!browser) {
            await initializeBrowser();
        }
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await loginToPortal(page);
        const lichHoc = await getSchedule(page, 1);

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
        bot.sendMessage(chatId, `❌ Lỗi khi lấy lịch học tuần sau: ${error.message} (Thời gian tối đa 1 phút)`);
        console.error(error);
    } finally {
        if (page) await page.close();
    }
});

// Lệnh /thongbao
bot.onText(/\/thongbao/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /thongbao command from chat:", chatId);
    bot.sendMessage(chatId, "🔔 Đang lấy danh sách thông báo, vui lòng chờ trong giây lát ⌛...");

    let page;
    try {
        if (!browser) {
            await initializeBrowser();
        }
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await loginToPortal(page);
        await page.goto("https://portal.vhu.edu.vn/student/index", { timeout: 10000, waitUntil: 'domcontentloaded' });
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
            bot.sendMessage(chatId, "🔔 Không lấy được chi tiết thông báo.");
        } else {
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
        }
    } catch (error) {
        bot.sendMessage(chatId, `❌ Lỗi khi lấy thông báo: ${error.message} (Thời gian tối đa 1 phút)`);
        console.error(error);
    } finally {
        if (page) await page.close();
    }
});

// Lệnh /congtac
bot.onText(/\/congtac/, async (msg) => {
    const chatId = msg.chat.id;
    console.log("Received /congtac command from chat:", chatId);
    bot.sendMessage(chatId, "📋 Đang lấy danh sách công tác xã hội, vui lòng chờ trong giây lát ⌛...");

    let page;
    try {
        if (!browser) {
            await initializeBrowser();
        }
        page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        await loginToPortal(page);
        await page.goto("https://portal.vhu.edu.vn/student/congtacxahoi", { timeout: 10000, waitUntil: 'domcontentloaded' });
        await page.waitForSelector(".MuiGrid-root", { timeout: 5000 });

        let yearDropdownSelector = 'div[role="button"][id="demo-simple-select-helper"]';
        await page.waitForSelector(yearDropdownSelector, { timeout: 5000 });
        await page.click(yearDropdownSelector);
        await page.evaluate(() => {
            const yearOption = document.querySelector('li[data-value="2024-2025"]');
            if (yearOption) yearOption.click();
        });

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
            bot.sendMessage(chatId, "📋 Không có công tác xã hội nào được tìm thấy.");
        } else {
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
        }
    } catch (error) {
        bot.sendMessage(chatId, `❌ Lỗi khi lấy công tác xã hội: ${error.message} (Thời gian tối đa 1 phút)`);
        console.error(error);
    } finally {
        if (page) await page.close();
    }
});

console.log("🤖 Bot Telegram đang chạy...");
