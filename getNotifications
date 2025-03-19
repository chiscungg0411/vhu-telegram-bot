async function getNotifications() {
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

    console.log("🔔 Đang truy cập trang thông báo...");
    await page.goto("https://portal.vhu.edu.vn/student/index", {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    console.log(`🌐 URL sau khi truy cập: ${page.url()}`);

    // Chờ bảng thông báo xuất hiện
    await page.waitForSelector(".MuiTableBody-root", { timeout: 10000 }).catch(async () => {
      const content = await page.content();
      throw new Error(`Không tìm thấy .MuiTableBody-root sau 10 giây. Nội dung trang: ${content.slice(0, 500)}...`);
    });
    const notifContent = await page.content();
    console.log(`📄 Nội dung trang thông báo: ${notifContent.slice(0, 500)}...`);

    const notifications = await page.evaluate(() => {
      const rows = document.querySelectorAll(".MuiTableBody-root tr");
      if (!rows.length) throw new Error("Không tìm thấy thông báo!");
      return Array.from(rows).map((row) => {
        const cols = row.querySelectorAll("td");
        return {
          MessageSubject: cols[0]?.querySelector("a")?.textContent.trim() || "Không rõ",
          SenderName: cols[1]?.textContent.trim() || "Không rõ",
          CreationDate: cols[2]?.textContent.trim() || "Không rõ",
        };
      });
    });

    console.log("✅ Đã lấy thông báo.");
    await browser.close();
    return notifications;
  } catch (error) {
    console.error("❌ Lỗi trong getNotifications:", error.message);
    await browser.close();
    throw error;
  }
}
