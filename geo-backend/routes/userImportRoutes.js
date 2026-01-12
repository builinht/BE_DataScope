const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const Record = require("../models/Record");

const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const upload = multer({ dest: uploadDir });

/**
 * POST /api/user/db/import
 * Import records cho chính user (merge)
 * User & Admin đều dùng được (check role ở server.js)
 */
router.post("/import", upload.single("file"), async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const raw = fs.readFileSync(req.file.path, "utf-8");
    const records = JSON.parse(raw);

    if (!Array.isArray(records)) {
      return res.status(400).json({ message: "Invalid JSON format" });
    }

    let inserted = 0;

    for (const r of records) {
      // 🧹 sanitize dữ liệu import
      const {
        _id,
        createdAt,
        updatedAt,
        userId: ignoredUserId,
        ...cleanData
      } = r;

      const result = await Record.updateOne(
        {
          userId,
          country: cleanData.country, // khóa merge (có thể đổi)
        },
        {
          $setOnInsert: {
            ...cleanData,
            userId,
          },
        },
        { upsert: true }
      );

      if (result.upsertedCount === 1) {
        inserted++;
      }
    }

    res.json({
      message: "User import merged successfully",
      inserted,
      skipped: records.length - inserted,
    });
  } catch (err) {
    console.error("User import error:", err);
    res.status(500).json({ message: "User import failed" });
  } finally {
    // 🧹 cleanup file upload
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        console.error("Failed to cleanup upload:", e.message);
      }
    }
  }
});

module.exports = router;
