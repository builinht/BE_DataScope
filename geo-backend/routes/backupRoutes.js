const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");

const router = express.Router();

router.post("/backup", (req, res) => {
  const timestamp = Date.now();
  const ADMIN_BACKUP_ROOT = path.join(__dirname, "../backups/admin");
  const backupDir = path.join(ADMIN_BACKUP_ROOT, `${timestamp}`);

  fs.mkdirSync(backupDir, { recursive: true });

  const cmd = `"${process.env.MONGODUMP_PATH}" --uri="${process.env.MONGO_URI}" --out="${backupDir}"`;

  console.log("Running:", cmd);

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error("Dump error:", err);
      console.error(stderr);
      return res.status(500).json({
        message: "Backup failed",
        error: err.message,
      });
    }

    fs.writeFileSync(
      path.join(backupDir, "meta.json"),
      JSON.stringify({ timestamp }, null, 2),
    );

    res.json({
      message: "Backup success",
      backupId: timestamp,
    });
  });
});

module.exports = router;
