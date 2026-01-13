// const express = require("express");
// const { exec } = require("child_process");
// const path = require("path");
// const fs = require("fs");

// const router = express.Router();

// const MONGORESTORE =
//   process.env.MONGORESTORE_PATH ||
//   "C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongorestore.exe";

// const ADMIN_BACKUP_ROOT = path.join(__dirname, "../backups/admin");

// /**
//  * POST /api/admin/db/restore/latest
//  * Restore backup mới nhất (SERVER-SIDE)
//  * ADMIN ONLY
//  */
// router.post("/restore/latest", (req, res) => {
//   if (!fs.existsSync(ADMIN_BACKUP_ROOT)) {
//     return res.status(404).json({ message: "No backups directory" });
//   }

//   const backups = fs.readdirSync(ADMIN_BACKUP_ROOT).sort();

//   if (backups.length === 0) {
//     return res.status(404).json({ message: "No backup found" });
//   }

//   const latest = backups[backups.length - 1];
//   const restoreDir = path.join(ADMIN_BACKUP_ROOT, latest, "geoinsight");

//   if (!fs.existsSync(restoreDir)) {
//     return res.status(404).json({ message: "Backup folder missing" });
//   }

//   const cmd = `"${MONGORESTORE}" --drop --db geoinsight "${restoreDir}"`;

//   console.log("[RESTORE]", cmd);

//   exec(cmd, (err, stdout, stderr) => {
//     if (err) {
//       console.error(stderr);
//       return res.status(500).json({
//         message: "Restore failed",
//         error: err.message,
//       });
//     }

//     res.json({
//       message: "Restore success",
//       backupId: latest,
//     });
//   });
// });

// /**
//  * POST /api/admin/db/restore/:id
//  * Restore theo ID cụ thể
//  */
// router.post("/restore/:id", (req, res) => {
//   const backupId = req.params.id;
//   const restoreDir = path.join(ADMIN_BACKUP_ROOT, backupId, "geoinsight");

//   if (!fs.existsSync(restoreDir)) {
//     return res.status(404).json({ message: "Backup not found" });
//   }

//   const cmd = `"${MONGORESTORE}" --drop --db geoinsight "${restoreDir}"`;

//   exec(cmd, (err) => {
//     if (err) {
//       return res.status(500).json({
//         message: "Restore failed",
//         error: err.message,
//       });
//     }

//     res.json({
//       message: "Restore success",
//       backupId,
//     });
//   });
// });

// module.exports = router;
const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const router = express.Router();

const MONGORESTORE =
  process.env.MONGORESTORE_PATH ||
  "C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongorestore.exe";

const ADMIN_BACKUP_ROOT = path.join(__dirname, "../backups/admin");

router.post("/restore/latest", (req, res) => {
  return res.status(403).json({
    message: "Admin restore is disabled to protect user data",
  });
});

router.post("/restore/:id", (req, res) => {
  return res.status(403).json({
    message: "Admin restore is disabled to protect user data",
  });
});

module.exports = router;