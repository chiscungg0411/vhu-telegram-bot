import puppeteer from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import puppeteerExtra from "puppeteer-extra";

puppeteerExtra.use(StealthPlugin());

async function getSchedule(username, password) {
    let browser;
    try {
        console.log("🔄 Khởi động trình duyệt...");
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        console.log("🔄 Truy cập trang đăng nhập...");
        await page.goto("https://portal.vhu.edu.vn/login", { waitUntil: "domcontentloaded", timeout: 90000 });

        console.log("🔎 Kiểm tra ô nhập tài khoản...");
        await page.waitForSelector("input[name='email']", { timeout: 10000 });
        await page.waitForSelector("input[name='password']", { timeout: 10000 });

        console.log("✍️ Nhập tài khoản...");
        await page.type("input[name='email']", username, { delay: 100 });
        await page.type("input[name='password']", password, { delay: 100 });

        console.log("🔓 Đăng nhập...");
        await Promise.all([
            page.click("button[type='submit']"),
            page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
        ]);

        // Kiểm tra nếu đăng nhập thất bại
        if (page.url().includes("login")) {
            console.error("❌ Sai tài khoản hoặc mật khẩu!");
            return "Sai tài khoản hoặc mật khẩu!";
        }

        console.log("📅 Truy cập trang lịch học...");
        await page.goto("https://portal.vhu.edu.vn/student/schedules", { waitUntil: "domcontentloaded", timeout: 20000 });

        console.log("📜 Kiểm tra dữ liệu lịch học...");
        await page.waitForSelector("table tbody tr", { timeout: 10000 });

        console.log("✅ Lịch học lấy được!");
        return "Lấy lịch học thành công!";
    } catch (error) {
        console.error("❌ Lỗi khi lấy lịch học:", error.message);
        return `Không thể lấy lịch học: ${error.message}`;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

export default getSchedule;