const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
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
  })
);

/* ======================
   2. PUBLIC ROUTES
====================== */
app.use("/api/auth", authRoutes);

/* ======================
   3. PROTECTED ROUTES
====================== */

// Records → user & admin đều dùng
app.use("/api/records", authMiddleware, recordsRoutes);

// ADMIN DB ROUTES → chỉ admin
app.use("/api/admin/db", authMiddleware, requireRole(["admin"]), backupRoutes);
app.use("/api/admin/db", authMiddleware, requireRole(["admin"]), restoreRoutes);
app.use("/api/admin/db", authMiddleware, requireRole(["admin"]), importRoutes);
app.use("/api/admin/db", authMiddleware, requireRole(["admin"]), exportRoutes);

// USER DB ROUTES → user & admin
app.use(
  "/api/user/db",
  authMiddleware,
  requireRole(["user", "admin"]),
  userBackupRestoreRoutes
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
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

/* ======================
   6. ERROR HANDLER
====================== */
// Thêm middleware xử lý lỗi chung
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || "Server error" });
});

/* ======================
   7. START SERVER
====================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
