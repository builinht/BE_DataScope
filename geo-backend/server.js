const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

// Middleware
const { authMiddleware, requireRole } = require("./middlewares/auth");

// Routes
const authRoutes = require("./routes/auth");
const recordsRoutes = require("./routes/recordsRoutes");
const backupRoutes = require("./routes/backupRoutes");
const restoreRoutes = require("./routes/restoreRoutes");
const importRoutes = require("./routes/importRoutes");
const exportRoutes = require("./routes/exportRoutes");
const userBackupRestoreRoutes = require("./routes/userBackupRestoreRoutes");

const app = express();

/* ======================
   1. CORS & JSON
====================== */
app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

/* ======================
   2. PUBLIC ROUTES
====================== */
app.use("/api/auth", authRoutes);

/* ======================
   2b. OPTIONAL AUTH MIDDLEWARE
   Dùng cho các route công khai nhưng cần biết user nếu có token
====================== */
const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    }
  } catch {
    // Token không hợp lệ → bỏ qua, coi như khách
  }
  next();
};

/* ======================
   2c. PUBLIC RECORD ROUTES (Khách không cần đăng nhập)
   Phải khai báo TRƯỚC app.use("/api/records", authMiddleware, ...)
   để Express match trước khi gặp authMiddleware
====================== */
// Tra cứu AQI — khách dùng được
app.get("/api/records/geo/airquality", optionalAuth, (req, res, next) => {
  recordsRoutes(req, res, next);
});

/* ======================
   3. PROTECTED ROUTES
====================== */
// Records → user & admin đều dùng (các route còn lại vẫn cần auth)
app.use("/api/records", authMiddleware, recordsRoutes);

// ADMIN DB ROUTES → chỉ admin
app.use(
  "/api/admin/db",
  authMiddleware,
  requireRole(["admin"]),
  backupRoutes,
  restoreRoutes,
  importRoutes,
  exportRoutes,
);

// USER DB ROUTES → user & admin
app.use(
  "/api/user/db",
  authMiddleware,
  requireRole(["user", "admin"]),
  userBackupRestoreRoutes,
);

/* ======================
   4. HEALTH CHECK
====================== */
app.get("/", (req, res) => {
  res.send("GeoInsight API Running 🚀");
});

/* ======================
   5. MONGO CONNECTION
====================== */
mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB Connected");
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const names = collections.map((c) => c.name);

    if (!names.includes("records_timeseries")) {
      await db.createCollection("records_timeseries", {
        timeseries: {
          timeField: "timestamp",
          metaField: "meta",
          granularity: "minutes",
        },
      });
      console.log("✅ Time-series collection created");
    }

    if (!names.includes("records_regular")) {
      await db.createCollection("records_regular");
      console.log("✅ Regular collection created");
    }

    if (!names.includes("countries_meta")) {
      await db.createCollection("countries_meta");
      console.log("✅ Countries meta collection created");
    }

    // ✅ Chỉ listen SAU KHI connect xong
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });
