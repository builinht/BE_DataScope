const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const MONGORESTORE_PATH =
  process.env.MONGORESTORE_PATH ||
  "C:\\Program Files\\MongoDB\\Tools\\100\\bin\\mongorestore.exe";

const ADMIN_BACKUP_ROOT = path.join(__dirname, "../backups/admin");

/* ======================
   Helper: chạy mongorestore
====================== */
function runRestore(restoreDir, backupId, res) {
  const args = [
    `--uri=${process.env.MONGO_URI}`,
    "--drop",                       // 🔥 BẮT BUỘC (fix time-series)
    "--gzip",                       // 🔥 BẮT BUỘC (vì backup dùng gzip)
    "--nsExclude=geoinsight.users", // 🔒 Giữ nguyên users
    "--numParallelCollections=4",
    "--numInsertionWorkersPerCollection=4",
    restoreDir,
  ];

  console.log(
    "[RESTORE] spawn args:",
    args.map((a) => (a.startsWith("--uri") ? "--uri=***" : a))
  );

  const child = spawn(MONGORESTORE_PATH, args);

  child.stdout.on("data", (d) =>
    console.log("[mongorestore]", d.toString().trim())
  );

  child.stderr.on("data", (d) =>
    console.log("[mongorestore]", d.toString().trim())
  );

  child.on("error", (err) => {
    console.error("[RESTORE error]", err);
    if (!res.headersSent)
      res.status(500).json({
        success: false,
        message: "Spawn error",
        error: err.message,
      });
  });

  child.on("close", (code) => {
    console.log("[RESTORE] exit code:", code);

    if (res.headersSent) return;

    if (code !== 0) {
      return res.status(500).json({
        success: false,
        message: `mongorestore exit code ${code}`,
      });
    }

    res.json({
      success: true,
      message: "Restore success",
      backupId,
    });
  });
}

/* ======================
   Tìm restoreDir
====================== */
function findRestoreDir(backupFolder) {
  const defaultPath = path.join(backupFolder, "geoinsight");
  if (fs.existsSync(defaultPath)) return defaultPath;

  const subFolders = fs
    .readdirSync(backupFolder)
    .filter((f) => {
      const full = path.join(backupFolder, f);
      return fs.statSync(full).isDirectory();
    });

  console.log("[RESTORE] Subfolders found:", subFolders);

  return subFolders.length > 0
    ? path.join(backupFolder, subFolders[0])
    : null;
}

/* ======================
   POST /api/admin/db/restore/latest
====================== */
router.post("/restore/latest", (req, res) => {
  if (!fs.existsSync(ADMIN_BACKUP_ROOT)) {
    return res.status(404).json({ message: "No backups directory" });
  }

  const backups = fs
    .readdirSync(ADMIN_BACKUP_ROOT)
    .filter((f) =>
      fs.statSync(path.join(ADMIN_BACKUP_ROOT, f)).isDirectory()
    )
    .sort();

  if (backups.length === 0) {
    return res.status(404).json({ message: "No backup found" });
  }

  const latest = backups[backups.length - 1];
  const backupFolder = path.join(ADMIN_BACKUP_ROOT, latest);
  const restoreDir = findRestoreDir(backupFolder);

  console.log(
    "[RESTORE] Latest:",
    latest,
    "| restoreDir:",
    restoreDir
  );

  if (!restoreDir) {
    return res
      .status(404)
      .json({ message: "Backup folder empty or missing" });
  }

  runRestore(restoreDir, latest, res);
});

/* ======================
   POST /api/admin/db/restore/:id
====================== */
router.post("/restore/:id", (req, res) => {
  const backupId = req.params.id;
  const backupFolder = path.join(ADMIN_BACKUP_ROOT, backupId);

  if (!fs.existsSync(backupFolder)) {
    return res.status(404).json({ message: "Backup not found" });
  }

  const restoreDir = findRestoreDir(backupFolder);

  if (!restoreDir) {
    return res
      .status(404)
      .json({ message: "Backup folder empty or missing" });
  }

  runRestore(restoreDir, backupId, res);
});

module.exports = router;