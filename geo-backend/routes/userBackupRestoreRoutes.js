const express = require("express");
const fs = require("fs");
const path = require("path");
const Record = require("../models/Record");

const router = express.Router();

const USER_BACKUP_ROOT = path.join(__dirname, "../backups/users");

/* ===== USER BACKUP ===== */
router.post("/backup", async (req, res) => {
  try {
    const userId = req.user.userId;
    const timestamp = Date.now();
    const userBackupDir = path.join(
      USER_BACKUP_ROOT,
      userId,
      String(timestamp)
    );
    fs.mkdirSync(userBackupDir, { recursive: true });

    const records = await Record.find({ userId }).lean();
    fs.writeFileSync(
      path.join(userBackupDir, "backup.json"),
      JSON.stringify(records, null, 2)
    );

    res.json({ message: "Backup success", backupId: timestamp });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "User backup failed" });
  }
});

/* ===== USER RESTORE ===== */
router.post("/restore", async (req, res) => {
  try {
    const userId = req.user.userId;
    const userDir = path.join(USER_BACKUP_ROOT, userId);

    if (!fs.existsSync(userDir)) {
      return res.status(404).json({ message: "No backup found" });
    }

    const backups = fs.readdirSync(userDir).sort();
    const latest = backups[backups.length - 1];
    const backupFile = path.join(userDir, latest, "backup.json");

    if (!fs.existsSync(backupFile)) {
      return res.status(404).json({ message: "Backup file missing" });
    }

    const data = JSON.parse(fs.readFileSync(backupFile, "utf-8"));

    let upserted = 0;

    for (const r of data) {
      const { _id, ...rest } = r;

      const result = await Record.updateOne(
        {
          userId,
          country: rest.country,
          fetchedAt: rest.fetchedAt,
        },
        { $set: { ...rest, userId } },
        { upsert: true }
      );

      if (result.upsertedCount > 0) upserted++;
    }

    res.json({
      message: "Restore success (merge)",
      total: data.length,
      inserted: upserted,
      backupId: latest,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "User restore failed",
      error: err.message,
    });
  }
});

module.exports = router;
