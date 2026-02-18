const express = require("express");
const { spawn } = require("child_process");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

/* ====== UPLOAD CONFIG ====== */
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

/**
 * POST /api/admin/db/import
 * Import kiểu MERGE – KHÔNG DROP DATA
 */
router.post("/import", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const filePath = req.file.path;

  const mongoimportPath =
    "C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongoimport.exe";

  const args = [
    `--uri=${process.env.MONGO_URI}`,
    "--db=geoinsight",
    "--collection=records_timeseries",
    `--file=${filePath}`,
    "--jsonArray",
  ];

  console.log("▶ Running mongoimport...");

  const child = spawn(mongoimportPath, args);

  child.stdout.on("data", (data) => {
    console.log(data.toString());
  });

  child.stderr.on("data", (data) => {
    console.log(data.toString()); // mongoimport thường log ở stderr
  });

  child.on("error", (err) => {
    console.error("Spawn error:", err);
    fs.unlinkSync(filePath);
    return res.status(500).json({
      message: "Import failed (spawn error)",
    });
  });

  child.on("close", (code) => {
    // luôn xóa file upload
    fs.unlinkSync(filePath);

    if (code !== 0) {
      return res.status(500).json({
        message: "Import failed",
      });
    }

    res.json({
      message: "Import success (merge mode – data safe)",
    });
  });
});

module.exports = router;
