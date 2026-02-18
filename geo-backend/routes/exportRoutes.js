const { spawn } = require("child_process");
const express = require("express");
const path = require("path");
const fs = require("fs");

const router = express.Router();

router.get("/export", (req, res) => {
  try {
    const exportsDir = path.join(__dirname, "../exports");
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const fileName = `records_${Date.now()}.json`;
    const filePath = path.join(exportsDir, fileName);

    const mongoexportPath =
      "C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongoexport.exe";

    const args = [
      `--uri=${process.env.MONGO_URI}`,
      "--db=geoinsight",
      "--collection=records_timeseries",
      `--out=${filePath}`,
      "--jsonArray",
    ];

    const child = spawn(mongoexportPath, args);

    child.stdout.on("data", (data) => {
      console.log(data.toString());
    });

    child.stderr.on("data", (data) => {
      console.log(data.toString()); // mongoexport log thường đi qua stderr
    });

    child.on("error", (err) => {
      console.error("Spawn error:", err);
      return res.status(500).json({ message: "Spawn failed" });
    });

    child.on("close", (code) => {
      console.log("Export finished with code:", code);

      if (code !== 0) {
        return res.status(500).json({ message: "Export failed" });
      }

      res.download(filePath, fileName, (err) => {
        if (err) {
          console.error("Download error:", err);
        }

        // Xóa file tạm sau khi gửi xong
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Failed to delete temp export file:", unlinkErr);
          }
        });
      });
    });
  } catch (e) {
    console.error("Export exception:", e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
