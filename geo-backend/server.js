const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const { auth } = require("express-oauth2-jwt-bearer");

// Routes
const recordsRoutes = require("./routes/recordsRoutes");
const backupRoutes = require("./routes/backupRoutes");
const restoreRoutes = require("./routes/restoreRoutes");
const importRoutes = require("./routes/importRoutes");
const exportRoutes = require("./routes/exportRoutes");
const userExportRoutes = require("./routes/userExportRoutes");
const userImportRoutes = require("./routes/userImportRoutes");


const app = express();

// 1. CORS CONFIGURATION
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  })
);

app.use(express.json());

// 2. AUTH0 JWT MIDDLEWARE (PROTECTED ROUTES)
const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  tokenSigningAlg: "RS256",
});

// 3. APPLY JWT ONLY TO PROTECTED ROUTES
app.use("/api/records", checkJwt);
app.use("/api/admin/db", checkJwt);
app.use("/api/user/db", checkJwt);

// 4. ROUTE REGISTRATION
app.use("/api/records", recordsRoutes);
app.use("/api/admin/db", backupRoutes);
app.use("/api/admin/db", restoreRoutes);
app.use("/api/admin/db", importRoutes);
app.use("/api/admin/db", exportRoutes);
app.use("/api/user/db", userExportRoutes);
app.use("/api/user/db", userImportRoutes);

// 5. MONGO DB CONNECTION
mongoose
  .connect(process.env.MONGO_URI, {})
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ DB Error:", err));

// 6. HEALTH CHECK ROUTE
app.get("/", (req, res) => {
  res.send("GeoInsight API Running 🚀");
});

// 7. START SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
