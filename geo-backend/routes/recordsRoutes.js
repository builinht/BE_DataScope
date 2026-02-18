const express = require("express");
const Record = require("../models/Record");
const axios = require("axios");
const { body, validationResult } = require("express-validator");
const jwt = require("jsonwebtoken");

const router = express.Router();
const { ObjectId } = require("mongodb");

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

      const meta = req.body.metadata || {};
      const weather = req.body.weather || {};
      const airQualityArr = Array.isArray(req.body.airQuality)
        ? req.body.airQuality
        : [];

      const latestByStation = {};
      let pm25Values = [];

      airQualityArr.forEach((m) => {
        const param = (m.parameter || "").toString().toLowerCase().trim();

        const val = Number(m.value);
        if (isNaN(val)) return;

        if (
          param.includes("pm2.5") ||
          param.includes("pm25") ||
          param === "pm2_5"
        ) {
          const station = m.locationName || "unknown";
          const measuredAt = new Date(m.measuredAt);

          if (
            !latestByStation[station] ||
            measuredAt > new Date(latestByStation[station].measuredAt)
          ) {
            latestByStation[station] = {
              value: val,
              measuredAt,
            };
          }
        }
      });

      // lấy values mới nhất mỗi trạm
      pm25Values = Object.values(latestByStation).map((s) => s.value);

      // tính trung bình
      const pm25 =
        pm25Values.length > 0
          ? pm25Values.reduce((a, b) => a + b, 0) / pm25Values.length
          : null;

      const recordData = {
        timestamp: req.body.timestamp
          ? new Date(req.body.timestamp)
          : new Date(),

        meta: {
          recordId: new ObjectId().toString(),
          country: req.body.country || meta.country || "",
          countryCode: meta.countryCode,
          capital: meta.capital,
          population: meta.population,
          currency: meta.currency,
          languages: Array.isArray(meta.languages)
            ? meta.languages
            : meta.languages
              ? [meta.languages]
              : [],
          flag: meta.flag,
          region: meta.region,
          subregion: meta.subregion,
          userId: req.user.userId,
        },

        temperature: weather.temperature,
        feelsLike: weather.feelsLike,
        humidity: weather.humidity,
        pressure: weather.pressure,
        weatherDescription: weather.description || weather.weatherDescription,

        pm25,
        airQualityStatus:
          pm25 != null ? getAQIStatus(pm25, "pm2.5") : undefined,
      };

      const saved = await new Record(recordData).save();
      res.status(201).json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to save record" });
    }
  },
);

/* ======================
   GET /api/records
====================== */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const records = await Record.find({ "meta.userId": req.user.userId }).sort({
      timestamp: -1,
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
    const totalRecords = await Record.countDocuments({ "meta.userId": userId });
    const uniqueCountries = await Record.distinct("meta.country", {
      "meta.userId": userId,
    });
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
    const recordId = req.params.id; // đây là meta.recordId, không phải MongoDB _id

    const record = await Record.findOne({ "meta.recordId": recordId });

    if (!record) {
      return res.status(404).json({ message: "Not found" });
    }

    // Check quyền
    if (req.user.role !== "admin") {
      const ownerId = record?.meta?.userId;
      if (!ownerId || ownerId.toString() !== req.user.userId) {
        return res.status(403).json({ message: "Forbidden" });
      }
    }

    const result = await Record.deleteMany({ "meta.recordId": recordId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Not found" });
    }

    res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete record" });
  }
});

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
          },
        );

        const locations = locationsResp.data?.results || [];
        if (locations.length > 0) {
          locationData = locations[0];

          if (locationData.id) {
            const latestResp = await axios.get(
              `https://api.openaq.org/v3/locations/${locationData.id}/latest`,
              { headers },
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
        const locResp = await axios.get("https://api.openaq.org/v3/locations", {
          params: { iso: country.toUpperCase(), limit: 10 },
          headers,
        });

        let locations = locResp.data?.results || [];
        if (locations.length > 0) {
          if (city) {
            const cityMatch = locations.find(
              (loc) =>
                loc.locality?.toLowerCase().includes(city.toLowerCase()) ||
                loc.name?.toLowerCase().includes(city.toLowerCase()),
            );
            if (cityMatch) locations = [cityMatch];
          }

          locationData = locations[0];
          fallbackUsed = true;

          if (locationData.id) {
            const latestResp = await axios.get(
              `https://api.openaq.org/v3/locations/${locationData.id}/latest`,
              { headers },
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
        const parameterName = meas.parameter?.name || meas.parameter || "pm2.5";

        return {
          parameter: parameterName,
          value,
          unit: meas.unit || meas.parameter?.units || "µg/m³",
          status: getAQIStatus(value, parameterName),
          measuredAt:
            meas.datetime?.utc || meas.date?.utc || new Date().toISOString(),
          locationName:
            locationData?.name || locationData?.locality || city || "Unknown",
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
/* ======================
   GET /api/records/history/:location
   Lịch sử thời tiết 7 ngày
====================== */
router.get("/history/:location", authMiddleware, async (req, res) => {
  try {
    const { location } = req.params;
    const { days = 7 } = req.query; // mặc định 7 ngày

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    const records = await Record.find({
      "meta.userId": req.user.userId,
      $or: [
        { "meta.country": new RegExp(location, "i") },
        { "meta.capital": new RegExp(location, "i") },
      ],
      timestamp: { $gte: daysAgo },
    }).sort({ timestamp: 1 }); // cũ → mới

    res.json(records);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch history" });
  }
});

/* ======================
   GET /api/records/compare-airquality
   So sánh chất lượng không khí
====================== */
router.get("/compare-airquality", authMiddleware, async (req, res) => {
  try {
    const { days = 7 } = req.query;

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    const comparison = await Record.aggregate([
      {
        $match: {
          "meta.userId": req.user.userId,
          timestamp: { $gte: daysAgo },
          $or: [{ pm25: { $exists: true, $ne: null } }],
        },
      },
      {
        $group: {
          _id: {
            capital: "$meta.capital",
            country: "$meta.country",
          },
          avgPM25: { $avg: "$pm25" },
          maxPM25: { $max: "$pm25" },
          minPM25: { $min: "$pm25" },
          count: { $sum: 1 },
          lastUpdate: { $max: "$timestamp" },
        },
      },
      {
        $project: {
          capital: "$_id.capital",
          country: "$_id.country",
          avgPM25: "$avgPM25",
          maxPM25: "$maxPM25",
          minPM25: "$minPM25",
          count: 1,
          lastUpdate: 1,
          _id: 0,
        },
      },
      { $sort: { avgPM25: -1 } }, // xếp theo PM2.5 cao nhất
    ]);

    res.json(comparison);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to compare air quality" });
  }
});

module.exports = router;
