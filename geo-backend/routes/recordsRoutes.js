const express = require("express");
const Record = require("../models/Record");
const axios = require("axios");
const { body, validationResult } = require("express-validator");
const jwt = require("jsonwebtoken");

const router = express.Router();

/* ======================
   Middleware: JWT auth
====================== */
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    if (!authHeader)
      return res.status(401).json({ message: "Missing Authorization header" });

    const token = authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Missing token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      userId: decoded.userId || decoded.sub,
      role: decoded.role || "user",
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

/* ======================
   Helper: AQI Status
====================== */
const getAQIStatus = (value, parameter = "pm2.5") => {
  if (typeof value !== "number" || isNaN(value)) return "Unknown";
  const p = parameter.toLowerCase();
  if (p.includes("pm25") || p.includes("pm2.5")) {
    if (value <= 12) return "Good";
    if (value <= 35.4) return "Moderate";
    if (value <= 55.4) return "Unhealthy for Sensitive";
    if (value <= 150.4) return "Unhealthy";
    if (value <= 250.4) return "Very Unhealthy";
    return "Hazardous";
  }
  if (p.includes("pm10")) {
    if (value <= 54) return "Good";
    if (value <= 154) return "Moderate";
    if (value <= 254) return "Unhealthy for Sensitive";
    if (value <= 354) return "Unhealthy";
    if (value <= 424) return "Very Unhealthy";
    return "Hazardous";
  }
  if (value <= 50) return "Good";
  if (value <= 100) return "Moderate";
  if (value <= 150) return "Unhealthy for Sensitive";
  if (value <= 200) return "Unhealthy";
  if (value <= 300) return "Very Unhealthy";
  return "Hazardous";
};

/* ======================
   Helper: OpenAQ headers
====================== */
const getOpenAQHeaders = () => {
  const headers = { Accept: "application/json" };
  if (process.env.OPENAQ_API_KEY)
    headers["X-API-Key"] = process.env.OPENAQ_API_KEY;
  return headers;
};

/* ======================
   POST /api/records
====================== */
router.post(
  "/",
  authMiddleware,
  body("country").notEmpty(),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty())
        return res.status(400).json({ errors: errors.array() });

      const recordData = {
        country: req.body.country,
        userId: req.user.userId,
        metadata: req.body.metadata || {},
        weather: req.body.weather || {},
        airQuality: Array.isArray(req.body.airQuality)
          ? req.body.airQuality
          : [],
        fetchedAt: new Date(),
      };

      const saved = await new Record(recordData).save();
      res.status(201).json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to save record" });
    }
  }
);

/* ======================
   GET /api/records
====================== */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const records = await Record.find({ userId: req.user.userId }).sort({
      createdAt: -1,
    });
    res.json(records);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch records" });
  }
});

/* ======================
   GET /api/records/stats
====================== */
router.get("/stats", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const totalRecords = await Record.countDocuments({ userId });
    const uniqueCountries = await Record.distinct("country", { userId });
    res.json({ totalRecords, uniqueCountriesCount: uniqueCountries.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ totalRecords: 0, uniqueCountriesCount: 0 });
  }
});

/* ======================
   DELETE /api/records/:id
====================== */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const record = await Record.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Not found" });

    if (
      req.user.role !== "admin" &&
      record.userId.toString() !== req.user.userId
    )
      return res.status(403).json({ message: "Forbidden" });

    await record.deleteOne();
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete record" });
  }
});

/* ======================
   GET /api/records/geo/airquality
====================== */
/* ======================
   GET /api/records/geo/airquality
====================== */
router.get("/geo/airquality", async (req, res) => {
  try {
    const { lat, lon, city, country } = req.query;
    const headers = getOpenAQHeaders();

    let locationData = null;
    let measurements = [];
    let fallbackUsed = false;

    // ===== 1. Search by coordinates =====
    if (lat && lon) {
      try {
        const locationsResp = await axios.get(
          "https://api.openaq.org/v3/locations",
          {
            params: {
              coordinates: `${lat},${lon}`,
              radius: 25000,
              limit: 10,
            },
            headers,
          }
        );

        const locations = locationsResp.data?.results || [];
        if (locations.length > 0) {
          locationData = locations[0];

          if (locationData.id) {
            const latestResp = await axios.get(
              `https://api.openaq.org/v3/locations/${locationData.id}/latest`,
              { headers }
            );
            measurements = latestResp.data?.results || [];
          }
        } else {
          fallbackUsed = true;
        }
      } catch (err) {
        fallbackUsed = true;
      }
    }

    // ===== 2. Fallback by country / city =====
    if (measurements.length === 0 && country) {
      try {
        const locResp = await axios.get(
          "https://api.openaq.org/v3/locations",
          {
            params: { iso: country.toUpperCase(), limit: 10 },
            headers,
          }
        );

        let locations = locResp.data?.results || [];
        if (locations.length > 0) {
          if (city) {
            const cityMatch = locations.find(
              (loc) =>
                loc.locality?.toLowerCase().includes(city.toLowerCase()) ||
                loc.name?.toLowerCase().includes(city.toLowerCase())
            );
            if (cityMatch) locations = [cityMatch];
          }

          locationData = locations[0];
          fallbackUsed = true;

          if (locationData.id) {
            const latestResp = await axios.get(
              `https://api.openaq.org/v3/locations/${locationData.id}/latest`,
              { headers }
            );
            measurements = latestResp.data?.results || [];
          }
        }
      } catch (err) {
        fallbackUsed = true;
      }
    }

    // ===== 3. Transform OpenAQ v3 response (FIX CHÍNH) =====
    const transformedMeasurements = measurements
      .filter((m) => m.value !== null && !isNaN(Number(m.value)))
      .map((meas) => {
        const value = Number(meas.value);
        const parameterName =
          meas.parameter?.name || meas.parameter || "pm2.5";

        return {
          parameter: parameterName,
          value,
          unit: meas.unit || meas.parameter?.units || "µg/m³",
          status: getAQIStatus(value, parameterName),
          measuredAt:
            meas.datetime?.utc ||
            meas.date?.utc ||
            new Date().toISOString(),
          locationName:
            locationData?.name ||
            locationData?.locality ||
            city ||
            "Unknown",
          coordinates: locationData?.coordinates || null,
        };
      });

    return res.json({
      results: transformedMeasurements,
      fallback: fallbackUsed,
    });
  } catch (err) {
    console.error("AirQuality error:", err.message);
    return res.status(500).json({
      results: [],
      fallback: true,
      message: "Air quality unavailable",
    });
  }
});

module.exports = router;
