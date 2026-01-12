const express = require("express");
const Record = require("../models/Record");

const router = express.Router();

/**
 * GET /api/user/db/export
 * Export records của chính user
 * User & Admin đều dùng được (check role ở server.js)
 */
router.get("/export", async (req, res) => {
  try {
    const userId = req.user.userId;

    const records = await Record.find({ userId }).lean();

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=user_records.json"
    );
    res.setHeader("Content-Type", "application/json");

    res.json(records);
  } catch (err) {
    console.error("User export error:", err);
    res.status(500).json({ message: "User export failed" });
  }
});

module.exports = router;
