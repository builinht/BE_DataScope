const express = require("express");
const { exec } = require("child_process");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const requirePermission = require("../middlewares/requirePermission");

const router = express.Router();

/* ====== UPLOAD CONFIG ====== */
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: uploadDir });

/* ====== IMPORT ROUTE ====== */
router.post(
  "/import",
  requirePermission("db:import"),
  upload.single("file"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const filePath = req.file.path;

    const cmd = `"C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongoimport.exe" \
      --db geoinsight \
      --collection records \
      --file "${filePath}" \
      --jsonArray \
      --drop`;

    console.log("▶ Running:", cmd);

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("Import error:", stderr || err.message);
        return res.status(500).json({
          message: "Import failed",
          error: stderr || err.message,
        });
      }

      res.json({
        message: "Import success",
      });
    });
  }
);

module.exports = router;
