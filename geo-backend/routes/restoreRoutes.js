const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const AdmZip = require("adm-zip");

const router = express.Router();

/* ===== UPLOAD CONFIG ===== */
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({ dest: uploadDir });

/**
 * POST /api/admin/db/restore/export
 * Restore từ JSON export (mongoimport)
 * ADMIN ONLY (check ở server.js)
 */
router.post("/restore/export", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Missing file" });

  const filePath = req.file.path;
  const mongoimportPath =
    `"C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongoimport.exe"`;

  const args = [
    "--db", "geoinsight",
    "--collection", "records",
    "--file", filePath,
    "--jsonArray",
    "--drop"
  ];

  const child = spawn(mongoimportPath, args, { shell: true });

  child.stdout.on("data", d => console.log(d.toString()));
  child.stderr.on("data", d => console.error(d.toString()));

  child.on("close", code => {
    fs.unlinkSync(filePath);
    if (code !== 0)
      return res.status(500).json({ message: "Restore export failed" });

    res.json({ message: "Restore export success" });
  });
});

/**
 * POST /api/admin/db/restore/backup
 * Restore từ ZIP backup (mongorestore)
 * ADMIN ONLY
 */
router.post("/restore/backup", upload.single("file"), (req, res) => {
  if (!req.file)
    return res.status(400).json({ message: "Missing backup file" });

  const zipPath = req.file.path;
  const extractDir = path.join(__dirname, "../tmp_restore");

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);
    fs.unlinkSync(zipPath);

    const findBson = dir => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) {
          const r = findBson(full);
          if (r) return r;
        } else if (f.endsWith(".bson")) {
          return full;
        }
      }
      return null;
    };

    const bsonFile = findBson(extractDir);
    if (!bsonFile) throw new Error("No .bson file found");

    const mongorestorePath =
      `"C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongorestore.exe"`;

    const args = [
      "--db", "geoinsight",
      "--collection", "records",
      "--drop",
      bsonFile
    ];

    const child = spawn(mongorestorePath, args, { shell: true });

    child.stdout.on("data", d => console.log(d.toString()));
    child.stderr.on("data", d => console.error(d.toString()));

    child.on("close", code => {
      fs.rmSync(extractDir, { recursive: true, force: true });
      if (code !== 0)
        return res.status(500).json({ message: "Restore backup failed" });

      res.json({ message: "Restore backup success" });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Restore backup failed", error: e.message });
  }
});

module.exports = router;
