const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const requirePermission = require("../middlewares/requirePermission");
const AdmZip = require("adm-zip");

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, "../uploads") });

/**
 * Restore từ JSON export (mongoimport)
 */
router.post(
  "/restore/export",
  requirePermission("db:restore"),
  upload.single("file"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Missing file" });

    const filePath = req.file.path;
    const mongoimportPath = `"C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongoimport.exe"`;
    const args = [
      "--db",
      "geoinsight",
      "--collection",
      "records",
      "--file",
      filePath,
      "--jsonArray",
      "--drop",
    ];

    const child = spawn(mongoimportPath, args, { shell: true });

    child.stdout.on("data", (data) => console.log("mongoimport stdout:", data.toString()));
    child.stderr.on("data", (data) => console.error("mongoimport stderr:", data.toString()));

    child.on("close", (code) => {
      try { fs.unlinkSync(filePath); } catch (e) { console.error(e.message); }
      if (code !== 0) return res.status(500).json({ message: "Restore export failed" });
      res.json({ message: "Restore export success" });
    });
  }
);

/**
 * Restore từ backup ZIP (mongorestore)
 */
router.post(
  "/restore/backup",
  requirePermission("db:restore"),
  upload.single("file"),
  (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Missing backup file" });

    const zipPath = req.file.path;
    const extractDir = path.join(__dirname, "../tmp_restore");

    // Xóa folder cũ nếu tồn tại
    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir);

    try {
      // Giải nén ZIP
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
      fs.unlinkSync(zipPath); // xóa file ZIP tạm

      // Tìm file .bson bất kỳ trong folder
      function findBsonFile(dir) {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const fullPath = path.join(dir, f);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const deeper = findBsonFile(fullPath);
            if (deeper) return deeper;
          } else if (f.endsWith(".bson")) {
            return fullPath;
          }
        }
        return null;
      }

      const bsonFile = findBsonFile(extractDir);
      if (!bsonFile) throw new Error("No .bson file found in backup");

      console.log("Restoring from file:", bsonFile);

      // Gọi mongorestore trực tiếp vào collection records
      const mongorestorePath = `"C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongorestore.exe"`;
      const args = [
        "--db", "geoinsight",
        "--collection", "records",
        "--drop",
        bsonFile
      ];

      const child = spawn(mongorestorePath, args, { shell: true });

      child.stdout.on("data", data => console.log("mongorestore stdout:", data.toString()));
      child.stderr.on("data", data => console.error("mongorestore stderr:", data.toString()));

      child.on("close", code => {
        try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch(e){}
        if (code !== 0) return res.status(500).json({ message: "Restore backup failed" });
        res.json({ message: "Restore backup success" });
      });

    } catch (e) {
      console.error(e);
      res.status(500).json({ message: "Restore backup failed", error: e.message });
    }
  }
);

module.exports = router;
