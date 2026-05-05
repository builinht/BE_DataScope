const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const XLSX = require("xlsx"); // npm install xlsx
const Record = require("../models/Record");
const CountryMeta = require("../models/CountryMeta");

const router = express.Router();
const USER_BACKUP_ROOT = path.join(__dirname, "../backups/users");

/* ====== UPLOAD CONFIG ====== */
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Chấp nhận cả .json và .xlsx
const upload = multer({
  dest: uploadDir,
  fileFilter: (req, file, cb) => {
    const isJson =
      file.mimetype === "application/json" ||
      file.originalname.endsWith(".json");
    const isExcel =
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.originalname.endsWith(".xlsx");

    if (isJson || isExcel) {
      cb(null, true);
    } else {
      cb(new Error("Only .json or .xlsx files are allowed"), false);
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

/* ===== USER EXPORT JSON ===== */
/*
 * GET /api/user/db/export
 * Xuất toàn bộ records của user ra file JSON.
 * Dùng để backup thủ công hoặc import lại sau này.
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

/* ===== USER EXPORT EXCEL ===== */
/*
 * GET /api/user/db/export/excel
 * Xuất toàn bộ records của user ra file .xlsx.
 * Dữ liệu được flatten thành bảng phẳng — dễ đọc, dễ lọc trong Excel.
 */
router.get("/export/excel", async (req, res) => {
  try {
    const userId = req.user.userId;

    const records = await Record.find({ "meta.userId": userId })
      .sort({ timestamp: -1 })
      .lean();

    if (records.length === 0) {
      return res.status(404).json({ message: "No records to export" });
    }

    // Lấy tên quốc gia từ countries_meta, query 1 lần cho tất cả countryCode
    const codes = [...new Set(records.map((r) => r.meta?.countryCode).filter(Boolean))];
    const metas = await CountryMeta.find({ countryCode: { $in: codes } }).lean();
    const codeToName = Object.fromEntries(metas.map((m) => [m.countryCode, m.country]));

    // Format timestamp sang UTC+7
    const toUTC7 = (date) => {
      const d = new Date(date);
      d.setHours(d.getHours() + 7);
      return d.toISOString().replace("T", " ").substring(0, 19) + " (UTC+7)";
    };

    // Flatten mỗi record thành 1 row phẳng cho Excel
    const rows = records.map((r) => ({
      timestamp: toUTC7(r.timestamp),
      countryCode: r.meta?.countryCode || "",
      countryName: codeToName[r.meta?.countryCode] || "",
      temperature: r.temperature ?? "",
      feelsLike: r.feelsLike ?? "",
      humidity: r.humidity ?? "",
      pressure: r.pressure ?? "",
      weatherDescription: r.weatherDescription || "",
      pm25: r.pm25 ?? "",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Records");

    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const fileName = `geoinsight_user_export_${Date.now()}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(buffer);
  } catch (err) {
    console.error("Excel export error:", err);
    res.status(500).json({ message: "Export Excel failed", error: err.message });
  }
});

/* ===== USER IMPORT JSON ===== */
/*
 * POST /api/user/db/import
 * Upload file JSON (từ export JSON trước đó), thêm records vào account hiện tại.
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

    const { ObjectId } = require("mongodb");
    const cleaned = records
      .filter((r) => r.meta?.countryCode && r.timestamp)
      .map(({ _id, __v, ...rest }) => ({
        ...rest,
        timestamp: new Date(rest.timestamp),
        meta: {
          ...rest.meta,
          userId,
          recordId: new ObjectId().toString(),
        },
      }));

    await Record.insertMany(cleaned, { ordered: false });

    res.json({
      message: "Import success (merge mode — existing data safe)",
      imported: cleaned.length,
      skipped: records.length - cleaned.length,
    });
  } catch (err) {
    console.error("User import error:", err);
    res.status(500).json({ message: "Import failed", error: err.message });
  } finally {
    fs.unlink(filePath, () => {});
  }
});

/* ===== USER IMPORT EXCEL ===== */
/*
 * POST /api/user/db/import/excel
 * Upload file .xlsx (từ export Excel trước đó), thêm records vào account hiện tại.
 * Cột bắt buộc trong file: timestamp, countryCode.
 * Các cột còn lại (temperature, feelsLike, humidity, pressure, weatherDescription, pm25)
 * nếu thiếu sẽ được bỏ qua và lưu là undefined.
 */
router.post("/import/excel", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const filePath = req.file.path;

  try {
    const userId = req.user.userId;

    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!rows.length) {
      return res.status(400).json({ message: "File is empty — no rows found" });
    }

    const { ObjectId } = require("mongodb");

    // Nếu file có cột countryName thay vì countryCode → lookup ngược lại
    const hasName = rows.some((r) => r.countryName && !r.countryCode);
    if (hasName) {
      const names = [...new Set(rows.map((r) => r.countryName).filter(Boolean))];
      const metasByName = await CountryMeta.find({ country: { $in: names } }).lean();
      const nameToCode = Object.fromEntries(metasByName.map((m) => [m.country, m.countryCode]));
      rows.forEach((r) => {
        if (!r.countryCode && r.countryName) {
          r.countryCode = nameToCode[r.countryName] || "";
        }
      });
    }

    const cleaned = rows
      .filter((r) => r.countryCode && r.timestamp) // bắt buộc có countryCode (sau khi đã lookup) và timestamp
      .map((r) => ({
        timestamp: new Date(r.timestamp),
        meta: {
          userId,
          countryCode: r.countryCode,
          recordId: new ObjectId().toString(),
        },
        temperature: r.temperature ?? undefined,
        feelsLike: r.feelsLike ?? undefined,
        humidity: r.humidity ?? undefined,
        pressure: r.pressure ?? undefined,
        weatherDescription: r.weatherDescription || undefined,
        pm25: r.pm25 ?? undefined,
      }));

    if (!cleaned.length) {
      return res.status(400).json({
        message: "No valid rows. File cần có cột 'timestamp' và 'countryCode' hoặc 'countryName'.",
      });
    }

    await Record.insertMany(cleaned, { ordered: false });

    res.json({
      message: "Import Excel success (merge mode — existing data safe)",
      imported: cleaned.length,
      skipped: rows.length - cleaned.length,
    });
  } catch (err) {
    console.error("Excel import error:", err);
    res.status(500).json({ message: "Import Excel failed", error: err.message });
  } finally {
    fs.unlink(filePath, () => {});
  }
});

module.exports = router;