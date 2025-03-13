import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());

async function getSchedule(username, password) {
    const browser = await puppeteer.launch({
          executablePath: '/usr/bin/google-chrome-stable', // Đường dẫn Chrome trên Render
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });


    const page = await browser.newPage();

    try {
        console.log("🔄 Truy cập trang đăng nhập...");
        await page.goto("https://portal.vhu.edu.vn/login", { waitUntil: "domcontentloaded", timeout: 90000 });

        console.log("⏳ Chờ trang tải...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log("🔎 Kiểm tra ô nhập tài khoản...");
        if (!(await page.$("input[name='email']"))) {
            console.error("❌ Không tìm thấy ô nhập email!");
            await browser.close();
            return "Lỗi: Không tìm thấy ô nhập email!";
        }

        console.log("✍️ Nhập tài khoản...");
        await page.type("input[name='email']", username, { delay: 100 });
        await page.type("input[name='password']", password, { delay: 100 });

        console.log("🔓 Đăng nhập...");
        await page.click("button[type='submit']");

        console.log("⌛ Chờ trang load sau đăng nhập...");
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 });

        // Kiểm tra nếu đăng nhập thất bại
        if (page.url().includes("login")) {
            console.error("❌ Sai tài khoản hoặc mật khẩu!");
            await browser.close();
            return "Sai tài khoản hoặc mật khẩu!";
        }

        console.log("📅 Truy cập trang lịch học...");
        await page.goto("https://portal.vhu.edu.vn/student/schedules", { waitUntil: "domcontentloaded", timeout: 20000 });

        console.log("📜 Kiểm tra dữ liệu lịch học...");
        await new Promise(resolve => setTimeout(resolve, 3000));

        if (!(await page.$("table tbody tr"))) {
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

export default getSchedule;
