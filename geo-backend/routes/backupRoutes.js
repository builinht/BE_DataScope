const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const MONGODUMP_PATH =
  process.env.MONGODUMP_PATH ||
  "C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongodump.exe";

const ADMIN_BACKUP_ROOT = path.join(__dirname, "../backups/admin");

router.post("/backup", (req, res) => {
  const timestamp = Date.now();
  const backupDir = path.join(ADMIN_BACKUP_ROOT, `${timestamp}`);

  fs.mkdirSync(backupDir, { recursive: true });

  const args = [
    `--uri=${process.env.MONGO_URI}`,
    `--out=${backupDir}`,
    "--gzip",                       // ✅ Nén BSON → giảm I/O disk ~60-70%
    "--numParallelCollections=4",   // ✅ Dump 4 collection song song
  ];

  console.log("[BACKUP] Running mongodump with gzip + parallel...");

  const child = spawn(MONGODUMP_PATH, args);

  child.stdout.on("data", (d) => console.log("[mongodump]", d.toString().trim()));
  child.stderr.on("data", (d) => console.log("[mongodump]", d.toString().trim()));

  child.on("error", (err) => {
    console.error("[BACKUP error]", err);
    if (!res.headersSent)
      res.status(500).json({ message: "Backup failed (spawn error)", error: err.message });
  });

  child.on("close", (code) => {
    console.log("[BACKUP] exit code:", code);
    if (res.headersSent) return;

    if (code !== 0) {
      return res.status(500).json({ message: `Backup failed (exit code ${code})` });
    }

    fs.writeFileSync(
      path.join(backupDir, "meta.json"),
      // Đánh dấu backup này dùng gzip → restore biết thêm --gzip
      JSON.stringify({ timestamp, gzip: true }, null, 2),
    );

    res.json({ message: "Backup success", backupId: timestamp });
  });
});

module.exports = router;