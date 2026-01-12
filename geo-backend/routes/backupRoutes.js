const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");

const router = express.Router();

router.post("/backup", (req, res) => {
  const timestamp = Date.now();
  const tmpRoot = path.join(__dirname, "../tmp_backup");
  const tempFolder = path.join(tmpRoot, `backup_${timestamp}`);
  const zipFile = path.join(tmpRoot, `backup_${timestamp}.zip`);
  const lockFile = path.join(tmpRoot, ".backup.lock");

  try {
    if (fs.existsSync(lockFile)) {
      return res.status(409).json({ message: "Backup already in progress" });
    }

    fs.mkdirSync(tmpRoot, { recursive: true });
    fs.mkdirSync(tempFolder, { recursive: true });
    fs.writeFileSync(lockFile, "LOCK");

    const cmd = `"${process.env.MONGODUMP_PATH}" --db geoinsight --out "${tempFolder}"`;

    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err) => {
      fs.unlinkSync(lockFile);

      if (err) {
        return res
          .status(500)
          .json({ message: "Backup failed", error: err.message });
      }

      fs.writeFileSync(
        path.join(tempFolder, "backup_meta.json"),
        JSON.stringify(
          { timestamp, db: "geoinsight", type: "snapshot" },
          null,
          2
        )
      );

      const zip = new AdmZip();
      zip.addLocalFolder(tempFolder);
      zip.writeZip(zipFile);

      res.download(zipFile, () => {
        fs.rmSync(tempFolder, { recursive: true, force: true });
        fs.unlinkSync(zipFile);
      });
    });
  } catch (e) {
    if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    res.status(500).json({ message: "Backup failed" });
  }
});
module.exports = router;