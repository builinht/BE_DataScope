const express = require("express");
const Record = require("../models/Record");
const requirePermission = require("../middlewares/requirePermission");

const router = express.Router();

router.get("/export", requirePermission("user:export"), async (req, res) => {
  try {
    const userId = req.auth.payload.sub;

    console.log("USER ID FROM TOKEN:", userId);

    const records = await Record.find({ userId }).lean();

    console.log("RECORDS FOUND:", records.length);

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=user_records.json"
    );
    res.setHeader("Content-Type", "application/json");

    res.json(records);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "User export failed" });
  }
});


module.exports = router;
