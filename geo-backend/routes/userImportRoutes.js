const express = require("express");
const multer = require("multer");
const fs = require("fs");
const Record = require("../models/Record");
const requirePermission = require("../middlewares/requirePermission");

const router = express.Router();
const upload = multer({ dest: "uploads/" });

router.post(
  "/import",
  requirePermission("user:import"),
  upload.single("file"),
  async (req, res) => {
    try {
      const userId = req.auth.payload.sub;

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
          { userId, country: cleanData.country }, //khóa duy nhất
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
    }
  }
);

module.exports = router;
