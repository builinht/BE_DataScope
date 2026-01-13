const { spawn } = require("child_process");
const express = require("express");
const path = require("path");
const fs = require("fs");

const router = express.Router();

/**
 * GET /api/admin/db/export
 * Quyền user/admin đã được check ở server.js
 */
router.get("/export", (req, res) => {
  try {
    const exportsDir = path.join(__dirname, "../exports");
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const fileName = `records_${Date.now()}.json`;
    const filePath = path.join(exportsDir, fileName);

    const mongoexportPath = `"C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongoexport.exe"`;

    const args = [
      "--db",
      "geoinsight",
      "--collection",
      "records",
      "--out",
      filePath,
      "--jsonArray",
    ];

    const child = spawn(mongoexportPath, args, { shell: true });

    child.stderr.on("data", (data) => {
      console.error("mongoexport error:", data.toString());
    });

    child.on("close", (code) => {
      if (code !== 0) {
        return res.status(500).json({ message: "Export failed" });
      }

      // res.download(filePath, fileName, (err) => {
      //   if (err) console.error("Download error:", err);
      // });
      // Gửi file xong thì xóa file tạm
      res.download(filePath, fileName, (err) => {
        if (err) console.error("Download error:", err);
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr)
            console.error("Failed to delete temp export file:", unlinkErr);
        });
      });
    });
  } catch (e) {
    console.error("Export exception:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
