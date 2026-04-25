const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const Record = require("../models/Record");

const router = express.Router();
const USER_BACKUP_ROOT = path.join(__dirname, "../backups/users");

/* ====== UPLOAD CONFIG (dùng cho import) ====== */
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const upload = multer({
  dest: uploadDir,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/json" || file.originalname.endsWith(".json")) {
      cb(null, true);
    } else {
      cb(new Error("Only .json files are allowed"), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // tối đa 10MB
});

/* ===== USER BACKUP ===== */
router.post("/backup", async (req, res) => {
  try {
    const userId = req.user.userId;
    const timestamp = Date.now();
    const userBackupDir = path.join(USER_BACKUP_ROOT, userId, String(timestamp));

    fs.mkdirSync(userBackupDir, { recursive: true });

    const records = await Record.find({ "meta.userId": userId }).lean();

    fs.writeFileSync(
      path.join(userBackupDir, "backup.json"),
      JSON.stringify(records, null, 2)
    );

    res.json({ success: true, backupId: timestamp, total: records.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
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

    await Record.deleteMany({ "meta.userId": userId });

    const cleaned = data.map(({ _id, __v, ...rest }) => rest);
    await Record.insertMany(cleaned);

    res.json({ message: "Restore success", total: cleaned.length, backupId: latest });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "User restore failed", error: err.message });
  }
});

/* ===== USER EXPORT ===== */
/*
 * GET /api/user/db/export
 * Xuất toàn bộ records của user hiện tại ra file JSON để tải về.
 * Chỉ trả về records thuộc về userId đang đăng nhập — không lộ data người khác.
 */
router.get("/export", async (req, res) => {
  try {
    const userId = req.user.userId;

    const records = await Record.find({ "meta.userId": userId })
      .sort({ timestamp: -1 })
      .lean();

    if (records.length === 0) {
      return res.status(404).json({ message: "No records to export" });
    }

    const fileName = `geoinsight_user_export_${Date.now()}.json`;
    const jsonContent = JSON.stringify(records, null, 2);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(jsonContent);
  } catch (err) {
    console.error("User export error:", err);
    res.status(500).json({ message: "Export failed", error: err.message });
  }
});

/* ===== USER IMPORT ===== */
/*
 * POST /api/user/db/import
 * Upload file JSON (export trước đó), thêm records vào account hiện tại.
 * - Ghi đè userId bằng userId hiện tại (bảo mật: tránh import data của người khác)
 * - Tạo recordId mới để tránh trùng
 * - KHÔNG xóa data cũ (merge mode)
 */
router.post("/import", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const filePath = req.file.path;

  try {
    const userId = req.user.userId;

    // Đọc và parse file JSON
    const raw = fs.readFileSync(filePath, "utf-8");
    let records;
    try {
      records = JSON.parse(raw);
    } catch {
      return res.status(400).json({ message: "Invalid JSON file" });
    }

    if (!Array.isArray(records)) {
      return res.status(400).json({ message: "File must contain a JSON array of records" });
    }

    if (records.length === 0) {
      return res.status(400).json({ message: "File is empty — no records to import" });
    }

    // Validate + làm sạch từng record
    const { ObjectId } = require("mongodb");
    const cleaned = records
      .filter((r) => r.meta?.countryCode && r.timestamp) // bỏ qua record thiếu field bắt buộc
      .map(({ _id, __v, ...rest }) => ({
        ...rest,
        timestamp: new Date(rest.timestamp),
        meta: {
          ...rest.meta,
          userId,                           // Gắn userId hiện tại
          recordId: new ObjectId().toString(), // Tạo recordId mới, tránh trùng
        },
      }));

    // if (cleaned.length === 0) {
    //   return res.status(400).json({
    //     message: "No valid records found. Each record needs 'meta.countryCode' and 'timestamp'.",
    //   });
    // }

    await Record.insertMany(cleaned, { ordered: false }); // ordered:false → bỏ qua lỗi từng doc, import được nhiều nhất

    res.json({
      message: "Import success (merge mode — existing data safe)",
      imported: cleaned.length,
      skipped: records.length - cleaned.length,
    });
  } catch (err) {
    console.error("User import error:", err);
    res.status(500).json({ message: "Import failed", error: err.message });
  } finally {
    // Luôn xóa file upload tạm
    fs.unlink(filePath, () => {});
  }
});

module.exports = router;