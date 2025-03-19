async function getSocialWork() {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    // Tắt tải hình ảnh để tăng tốc
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.resourceType() === "image") req.abort();
      else req.continue();
    });

    console.log("🔑 Đang đăng nhập vào portal...");
    await login(page, process.env.VHU_EMAIL, process.env.VHU_PASSWORD);

    console.log("📋 Truy cập trang công tác xã hội...");
    await page.goto("https://portal.vhu.edu.vn/student/socialworks", {
      waitUntil: "domcontentloaded",
      timeout: 600000, // Tăng timeout lên 10 phút
    });
    console.log("✅ Trang công tác xã hội đã tải xong.");

    // Chờ bảng dữ liệu xuất hiện
    console.log("⏳ Đang chờ dữ liệu công tác xã hội...");
    await page.waitForSelector("table tbody tr", { timeout: 60000 }); // Tăng timeout lên 60 giây
    console.log("✅ Dữ liệu công tác xã hội đã sẵn sàng.");

    // Trích xuất dữ liệu
    const socialWork = await page.evaluate(() => {
      const rows = document.querySelectorAll("table tbody tr");
      if (!rows.length) throw new Error("Không tìm thấy dữ liệu công tác xã hội!");
      return Array.from(rows).map((row) => {
        const cols = row.querySelectorAll("td");
        return {
          Details: cols[0]?.textContent.trim() || "Không rõ",
          Location: cols[1]?.textContent.trim() || "Không rõ",
          NumRegisted: cols[2]?.textContent.trim() || "Không rõ",
          MarkConverted: cols[3]?.textContent.trim() || "0",
          FromTime: cols[4]?.textContent.trim() || "Không rõ",
          ToTime: cols[5]?.textContent.trim() || "Không rõ",
        };
      });
    });

    console.log("✅ Đã lấy dữ liệu công tác xã hội.");
    await browser.close();
    return socialWork;
  } catch (error) {
    console.error("❌ Lỗi trong getSocialWork:", error.message);
    await browser.close();
    throw error;
  }
}
