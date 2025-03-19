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

    console.log("📅 Đang truy cập trang lịch học...");
    await page.goto("https://portal.vhu.edu.vn/student/schedules", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    console.log(`🌐 URL sau khi truy cập: ${page.url()}`);

    // Chờ bảng lịch học xuất hiện
    await page.waitForSelector("#psc-table-head", { timeout: 10000 }).catch(async () => {
      const content = await page.content();
      throw new Error(`Không tìm thấy #psc-table-head sau 10 giây. Nội dung trang: ${content.slice(0, 500)}...`);
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
