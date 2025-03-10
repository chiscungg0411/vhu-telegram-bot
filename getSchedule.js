const puppeteer = require("puppeteer");

async function getSchedule(username, password) {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    try {
        console.log("🔄 Truy cập trang đăng nhập...");
        await page.goto("https://portal.vhu.edu.vn/login", { waitUntil: "networkidle2", timeout: 90000 });

        console.log("⏳ Chờ trang tải...");
        await page.waitForTimeout(5000);

        console.log("🔎 Kiểm tra ô nhập tài khoản...");
        await page.waitForSelector("input[name='email']", { timeout: 20000 });

        console.log("✍️ Nhập tài khoản...");
        await page.type("input[name='email']", username, { delay: 100 });
        await page.type("input[name='password']", password, { delay: 100 });

        console.log("🔓 Đăng nhập...");
        await page.waitForSelector("button[type='submit']", { visible: true });
        await page.click("button[type='submit']");

        console.log("⌛ Chờ trang load sau đăng nhập...");
        await page.waitForTimeout(3000);

        // Kiểm tra xem có lỗi đăng nhập không
        const loginError = await page.$(".MuiAlert-message");
        if (loginError) {
            console.error("❌ Sai tài khoản hoặc mật khẩu!");
            await browser.close();
            return "Sai tài khoản hoặc mật khẩu!";
        }

        await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 });

        console.log("📅 Truy cập trang lịch học...");
        await page.goto("https://portal.vhu.edu.vn/student/schedules", { waitUntil: "networkidle2", timeout: 20000 });

        console.log("📜 Kiểm tra dữ liệu lịch học...");
        await page.waitForTimeout(3000);

        await page.waitForSelector("table tbody tr", { timeout: 7000 });
        const rows = await page.$$("table tbody tr");
        if (rows.length === 0) {
            console.error("❌ Không tìm thấy lịch học!");
            await browser.close();
            return "Không có lịch học!";
        }

        console.log("✅ Lịch học lấy được!");
        await browser.close();
        return "Lấy lịch học thành công!";
    } catch (error) {
        console.error("❌ Lỗi khi lấy lịch học:", error);
        await browser.close();
        return "Không thể lấy lịch học.";
    }
}

module.exports = getSchedule;
