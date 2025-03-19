const puppeteer = require("puppeteer-core");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const puppeteerExtra = require("puppeteer-extra");

puppeteerExtra.use(StealthPlugin());

async function launchBrowser() {
  try {
    const browser = await puppeteerExtra.launch({
      executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome-stable",
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-background-networking",
        "--no-zygote",
        "--single-process",
        "--disable-accelerated-2d-canvas",
        "--disable-features=site-per-process",
      ],
      defaultViewport: { width: 1280, height: 720 },
      timeout: 60000,
    });
    console.log("✅ Trình duyệt Puppeteer đã khởi động.");
    return browser;
  } catch (error) {
    console.error("❌ Lỗi khởi động trình duyệt:", error.message);
    throw new Error("Không thể khởi động trình duyệt.");
  }
}

async function login(page, username, password, retries = 5) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔑 Thử đăng nhập lần ${attempt}...`);
      await page.goto("https://portal.vhu.edu.vn/login", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
      console.log("✅ Trang đăng nhập đã tải.");

      await page.waitForSelector("input[name='email']", { timeout: 60000 });
      await page.type("input[name='email']", username, { delay: 50 });
      await page.type("input[name='password']", password, { delay: 50 });
      console.log("✍️ Đã nhập thông tin đăng nhập.");

      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      );

      await page.waitForSelector("button[type='submit']", { timeout: 60000 });
      await page.click("button[type='submit']");
      console.log("⏳ Đang chờ phản hồi sau đăng nhập...");

      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
      const finalUrl = page.url();
      console.log(`🌐 URL sau đăng nhập: ${finalUrl}`);

      if (finalUrl.includes("/login")) {
        const content = await page.content();
        console.log(`📄 Nội dung trang sau đăng nhập thất bại: ${content.slice(0, 500)}...`);
        const errorMessage = await page.evaluate(() =>
          document.body.innerText.includes("Username or password is incorrect")
            ? "Sai tên đăng nhập hoặc mật khẩu."
            : "Đăng nhập thất bại (có thể do CAPTCHA hoặc lỗi server)."
        );
        throw new Error(`Đăng nhập thất bại: ${errorMessage}`);
      }

      console.log("✅ Đăng nhập thành công:", finalUrl);
      return true;
    } catch (error) {
      console.error(`❌ Lỗi đăng nhập lần ${attempt}:`, error.message);
      console.log(`🌐 URL khi lỗi: ${page.url()}`);
      const pageContent = await page.content();
      console.log(`📄 Nội dung trang khi lỗi: ${pageContent.slice(0, 500)}...`);
      if (attempt === retries) throw new Error(`Đăng nhập thất bại sau ${retries} lần: ${error.message}`);
      console.log("⏳ Thử lại sau 5 giây...");
      await page.close();
      await new Promise((resolve) => setTimeout(resolve, 5000));
      page = await (await launchBrowser()).newPage();
    }
  }
}

async function getSchedule(weekOffset = 0) {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (["image", "stylesheet", "font"].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);
    console.log("🏠 Điều hướng đến trang chủ sinh viên...");
    await page.goto("https://portal.vhu.edu.vn/student", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    console.log(`🌐 URL sau khi vào trang chủ: ${page.url()}`);
    const homeContent = await page.content();
    console.log(`📄 Nội dung trang chủ: ${homeContent.slice(0, 500)}...`);

    // Tìm và nhấp vào menu "Lịch học" (nếu có)
    const scheduleLink = await page.$("a[href='/student/schedules']");
    if (scheduleLink) {
      console.log("📅 Nhấp vào menu 'Lịch học'...");
      await scheduleLink.click();
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 });
    } else {
      console.log("📅 Không tìm thấy menu, điều hướng trực tiếp đến lịch học...");
      await page.goto("https://portal.vhu.edu.vn/student/schedules", {
        waitUntil: "networkidle2",
        timeout: 60000,
      });
    }

    console.log(`🌐 URL sau khi truy cập lịch học: ${page.url()}`);
    await page.waitForSelector("#psc-table-head", { timeout: 20000 }).catch(async () => {
      const content = await page.content();
      throw new Error(`Không tìm thấy #psc-table-head sau 20 giây. Nội dung trang: ${content.slice(0, 500)}...`);
    });
    const scheduleContent = await page.content();
    console.log(`📄 Nội dung trang lịch học: ${scheduleContent.slice(0, 500)}...`);

    // Kiểm tra và chọn tuần
    const weekButtons = await page.$$(".MuiButton-containedPrimary");
    if (weekButtons.length > 0) {
      if (weekOffset === 1 && weekButtons[2]) {
        console.log("🔜 Nhấn nút 'SkipNext' để lấy tuần sau...");
        await weekButtons[2].click();
        await page.waitForTimeout(3000);
      } else if (weekButtons[1]) {
        console.log("⏳ Nhấn nút 'Hiện tại' để lấy tuần này...");
        await weekButtons[1].click();
        await page.waitForTimeout(3000);
      }
    } else {
      console.log("⚠️ Không tìm thấy nút chọn tuần, dùng tuần mặc định.");
    }

    const scheduleData = await page.evaluate(() => {
      const table = document.querySelector("#psc-table-head");
      if (!table) throw new Error("Không tìm thấy bảng lịch học!");

      const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
        th.textContent.trim()
      );
      const days = headers.slice(1);
      const schedule = {};

      days.forEach((day, dayIndex) => {
        schedule[day] = [];
        const cells = table.querySelectorAll(`tbody td:nth-child(${dayIndex + 2})`);
        cells.forEach((cell) => {
          const detail = cell.querySelector(".DetailSchedule");
          if (detail) {
            const spans = detail.querySelectorAll("span");
            schedule[day].push({
              room: spans[0]?.textContent.trim() || "Không rõ",
              subject: spans[1]?.textContent.trim() || "Không rõ",
              classCode: spans[2]?.textContent.replace("LHP: ", "").trim() || "Không rõ",
              periods: spans[4]?.textContent.replace("Tiết: ", "").trim() || "Không rõ",
              startTime: spans[5]?.textContent.replace("Giờ bắt đầu: ", "").trim() || "Không rõ",
              professor: spans[6]?.textContent.replace("GV: ", "").trim() || "Không rõ",
            });
          }
        });
      });

      const weekInfo = document.querySelector(".MuiSelect-select")?.textContent.trim() || days[0].split("\n")[1] + " - " + days[days.length - 1].split("\n")[1];
      return { schedule, week: weekInfo };
    });

    console.log("✅ Đã lấy lịch học.");
    await browser.close();
    return scheduleData;
  } catch (error) {
    console.error("❌ Lỗi trong getSchedule:", error.message);
    await browser.close();
    throw error;
  }
}

module.exports = { getSchedule };
