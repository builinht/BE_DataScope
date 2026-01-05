const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const router = express.Router();
const requirePermission = require("../middlewares/requirePermission");

router.post("/backup", requirePermission("db:backup"), (req, res) => {
  const timestamp = Date.now();
  const tempFolder = path.join(__dirname, "../tmp_backup", `backup_${timestamp}`);
  const zipFile = path.join(__dirname, "../tmp_backup", `backup_${timestamp}.zip`);

  // Tạo folder tạm
  if (!fs.existsSync(tempFolder)) fs.mkdirSync(tempFolder, { recursive: true });

  // MongoDB dump
  const cmd = `"C:\\Program Files\\MongoDB\\Tools\\100.9.4\\bin\\mongodump.exe" --db geoinsight --out "${tempFolder}"`;
  exec(cmd, (err) => {
    if (err) return res.status(500).json({ message: "Backup failed", error: err.message });

    // Nén folder thành ZIP
    const zip = new AdmZip();
    zip.addLocalFolder(tempFolder);
    zip.writeZip(zipFile);

    // Gửi file ZIP về FE
    res.download(zipFile, `geoinsight_backup_${timestamp}.zip`, (err) => {
      if (err) console.error(err);

      // Xóa tạm sau khi gửi
      fs.rmSync(tempFolder, { recursive: true, force: true });
      fs.unlinkSync(zipFile);
    });
  });
});

module.exports = router;
