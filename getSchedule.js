import puppeteer from "puppeteer-core";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import puppeteerExtra from "puppeteer-extra";

puppeteerExtra.use(StealthPlugin());

async function getSchedule(username, password, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const browser = await puppeteerExtra.launch({
            executablePath: '/usr/bin/google-chrome-stable',
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        try {
            console.log(`🔄 Thử lần ${attempt}: Truy cập trang đăng nhập...`);
            await page.goto("https://portal.vhu.edu.vn/login", { 
                waitUntil: "domcontentloaded", 
                timeout: 180000 
            });
            console.log("✅ Trang đăng nhập đã tải xong.");

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
            await page.waitForNavigation({ 
                waitUntil: "domcontentloaded", 
                timeout: 180000 
            });
            console.log("✅ Đăng nhập thành công.");

            if (page.url().includes("login")) {
                console.error("❌ Sai tài khoản hoặc mật khẩu!");
                await browser.close();
                return "Sai tài khoản hoặc mật khẩu!";
            }

            console.log("📅 Truy cập trang lịch học...");
            await page.goto("https://portal.vhu.edu.vn/student/schedules", { 
                waitUntil: "domcontentloaded", 
                timeout: 180000 
            });
            console.log("✅ Trang lịch học đã tải xong.");

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
            console.error(`❌ Lỗi khi lấy lịch học (lần ${attempt}):`, error.message);
            await browser.close();
            if (attempt === retries) {
                return `Không thể lấy lịch học sau ${retries} lần thử. Chi tiết: ${error.message}`;
            }
            console.log(`⏳ Thử lại sau 5 giây...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

export default getSchedule;