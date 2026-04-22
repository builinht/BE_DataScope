const express = require("express");
const mongoose = require("mongoose");
const Record = require("../models/Record");
const { RecordRegular } = require("../models/Record");
const CountryMeta = require("../models/CountryMeta");
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
  } catch {
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

      // Tính pm25
      const airQualityArr = Array.isArray(req.body.airQuality)
        ? req.body.airQuality
        : [];
      const latestByStation = {};
      airQualityArr.forEach((m) => {
        const param = (m.parameter || "").toString().toLowerCase().trim();
        const val = Number(m.value);
        if (isNaN(val) || val < 0 || val >= 1000) return;
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
            latestByStation[station] = { value: val, measuredAt };
          }
        }
      });
      const pm25Values = Object.values(latestByStation).map((s) => s.value);
      const pm25 =
        pm25Values.length > 0
          ? pm25Values.reduce((a, b) => a + b, 0) / pm25Values.length
          : null;

      const countryCode = meta.countryCode || "";
      const countryName = req.body.country || meta.country || "";

      // Upsert country metadata vào collection riêng
      await CountryMeta.findOneAndUpdate(
        { countryCode },
        {
          countryCode,
          country: countryName,
          capital: meta.capital,
          population: meta.population,
          currency: meta.currency,
          languages: Array.isArray(meta.languages)
            ? meta.languages
            : meta.languages
              ? [meta.languages]
              : [],
          flag: meta.flag || "",
          region: meta.region,
          subregion: meta.subregion,
        },
        { upsert: true, new: true },
      );

      // Data lưu vào cả 2 collections (cùng cấu trúc)
      const docData = {
        timestamp: req.body.timestamp
          ? new Date(req.body.timestamp)
          : new Date(),
        meta: {
          userId: req.user.userId,
          countryCode,
        },
        temperature: weather.temperature,
        feelsLike: weather.feelsLike,
        humidity: weather.humidity,
        pressure: weather.pressure,
        weatherDescription: weather.description || weather.weatherDescription,
        pm25,
      };

      const saved = await new Record(docData).save();
      await new RecordRegular(docData).save().catch(() => {});

      res.status(201).json(saved);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to save record" });
    }
  },
);

/* ======================
   GET /api/records
   JOIN với countries_meta để trả về đầy đủ thông tin
====================== */
router.get("/", authMiddleware, async (req, res) => {
  try {
    const records = await Record.find({ "meta.userId": req.user.userId })
      .sort({ timestamp: -1 })
      .lean();

    const codes = [
      ...new Set(records.map((r) => r.meta.countryCode).filter(Boolean)),
    ];
    const metas = await CountryMeta.find({
      countryCode: { $in: codes },
    }).lean();
    const metaMap = Object.fromEntries(metas.map((m) => [m.countryCode, m]));

    const enriched = records.map((r) => {
      const cm = metaMap[r.meta.countryCode] || {};
      return {
        ...r,
        meta: {
          ...r.meta,
          country: cm.country,
          capital: cm.capital,
          population: cm.population,
          currency: cm.currency,
          languages: cm.languages,
          flag: cm.flag,
          region: cm.region,
          subregion: cm.subregion,
        },
        airQualityStatus: r.pm25 != null ? getAQIStatus(r.pm25, "pm2.5") : null,
      };
    });

    res.json(enriched);
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
    const countryCodes = await Record.distinct("meta.countryCode", {
      "meta.userId": userId,
    });
    res.json({ totalRecords, uniqueCountriesCount: countryCodes.length });
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
    const id = req.params.id;
    const record = await Record.findOne({ _id: id });

    if (!record) return res.status(404).json({ message: "Not found" });

    if (req.user.role !== "admin") {
      if (record?.meta?.userId !== req.user.userId)
        return res.status(403).json({ message: "Forbidden" });
    }

    await Record.deleteOne({ _id: id });
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
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

    if (lat && lon) {
      try {
        const locationsResp = await axios.get(
          "https://api.openaq.org/v3/locations",
          {
            params: { coordinates: `${lat},${lon}`, radius: 25000, limit: 10 },
            headers,
          },
        );
        const locations = locationsResp.data?.results || [];
        if (locations.length > 0) {
          locationData = locations[0];
          if (locationData.id) {
            const latestResp = await axios.get(
              `https://api.openaq.org/v3/locations/${locationData.id}/latest`,
              {
                params: { parameter: "pm25" }, // Lọc chỉ PM2.5
                headers,
              },
            );
            measurements = latestResp.data?.results || [];
          }
        } else {
          fallbackUsed = true;
        }
      } catch {
        fallbackUsed = true;
      }
    }

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
              {
                params: { parameter: "pm25" }, // Lọc chỉ PM2.5
                headers,
              },
            );
            measurements = latestResp.data?.results || [];
          }
        }
      } catch {
        fallbackUsed = true;
      }
    }

    const transformedMeasurements = measurements
      .filter((m) => {
        const val = Number(m.value);
        return m.value !== null && !isNaN(val) && val >= 0 && val < 1000;
      })
      .map((meas) => {
        const value = Number(meas.value);
        let parameterName = (
          meas.parameter?.name ||
          meas.parameter ||
          ""
        ).toLowerCase();
        if (!parameterName) parameterName = "pm2.5";
        const isPM25 =
          parameterName.includes("pm25") || parameterName.includes("pm2.5");
        return {
          parameter: isPM25 ? "pm2.5" : parameterName,

          value,
          unit: meas.unit || meas.parameter?.units || "µg/m³",
          status: getAQIStatus(value, "pm2.5"), // Luôn dùng "pm2.5" cho status
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
====================== */
router.get("/history/:location", authMiddleware, async (req, res) => {
  try {
    const { location } = req.params;
    const { days = 7 } = req.query;

    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(days));

    const matchedMetas = await CountryMeta.find({
      $or: [
        { country: new RegExp(location, "i") },
        { capital: new RegExp(location, "i") },
      ],
    }).lean();
    const matchedCodes = matchedMetas.map((m) => m.countryCode);

    const records = await Record.find({
      "meta.userId": req.user.userId,
      "meta.countryCode": { $in: matchedCodes },
      timestamp: { $gte: daysAgo },
    })
      .sort({ timestamp: 1 })
      .lean();

    const metaMap = Object.fromEntries(
      matchedMetas.map((m) => [m.countryCode, m]),
    );
    const enriched = records.map((r) => {
      const cm = metaMap[r.meta.countryCode] || {};
      return { ...r, meta: { ...r.meta, ...cm } };
    });

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch history" });
  }
});

/* ======================
   GET /api/records/compare-airquality
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
          pm25: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$meta.countryCode",
          avgPM25: { $avg: "$pm25" },
          maxPM25: { $max: "$pm25" },
          minPM25: { $min: "$pm25" },
          count: { $sum: 1 },
          lastUpdate: { $max: "$timestamp" },
        },
      },
      { $sort: { avgPM25: -1 } },
    ]);

    const codes = comparison.map((c) => c._id);
    const metas = await CountryMeta.find({
      countryCode: { $in: codes },
    }).lean();
    const metaMap = Object.fromEntries(metas.map((m) => [m.countryCode, m]));

    const result = comparison.map((c) => ({
      countryCode: c._id,
      country: metaMap[c._id]?.country,
      capital: metaMap[c._id]?.capital,
      avgPM25: c.avgPM25,
      maxPM25: c.maxPM25,
      minPM25: c.minPM25,
      count: c.count,
      lastUpdate: c.lastUpdate,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to compare air quality" });
  }
});

/* ======================
   GET /api/records/storage-compare
   So sánh storage: time-series vs regular
   Dùng $collStats aggregation (MongoDB 4.4+)
====================== */
router.get("/storage-compare", authMiddleware, async (req, res) => {
  try {
    const db = mongoose.connection.db;

    async function getCollStats(collName) {
      try {
        const result = await db
          .collection(collName)
          .aggregate([{ $collStats: { storageStats: { scale: 1 } } }])
          .toArray();
        if (!result?.length) return null;
        const s = result[0].storageStats;
        return {
          storageSize: s.storageSize,
          totalSize: s.totalSize,
          indexSize: s.totalIndexSize,
          count: s.count,
          avgDocSize: s.avgObjSize || 0,
        };
      } catch {
        return null;
      }
    }

    const [tsStats, regStats] = await Promise.all([
      getCollStats("records_timeseries"),
      getCollStats("records_regular"),
    ]);

    if (!tsStats) {
      return res
        .status(500)
        .json({ message: "Cannot read records_timeseries stats" });
    }

    const fmt = (bytes) =>
      bytes >= 1024 * 1024
        ? (bytes / 1024 / 1024).toFixed(2) + " MB"
        : (bytes / 1024).toFixed(2) + " KB";

    let storageRatio = null;
    let percentDiff = null;
    let message = "";

    if (regStats && regStats.totalSize > 0 && tsStats.totalSize > 0) {
      storageRatio = regStats.totalSize / tsStats.totalSize;
      percentDiff =
        ((regStats.totalSize - tsStats.totalSize) / regStats.totalSize) * 100;

      if (percentDiff > 0) {
        message = `Time-series tiết kiệm ${percentDiff.toFixed(1)}% tổng dung lượng (${storageRatio.toFixed(2)}x nhỏ hơn)`;
      } else {
        message = `Time-series lớn hơn regular ${Math.abs(percentDiff).toFixed(1)}%`;
      }
    }

    res.json({
      timeseries: {
        docs: tsStats.count,
        storageSize: fmt(tsStats.storageSize),
        totalSize: fmt(tsStats.totalSize),
        indexSize: fmt(tsStats.indexSize),
        avgDocSize: tsStats.avgDocSize + " B",
      },
      regular: regStats
        ? {
            docs: regStats.count,
            storageSize: fmt(regStats.storageSize),
            totalSize: fmt(regStats.totalSize),
            indexSize: fmt(regStats.indexSize),
            avgDocSize: regStats.avgDocSize + " B",
          }
        : null,
      comparison: {
        // So sánh storageSize (data thuần)
        storageRatio:
          (regStats.storageSize / tsStats.storageSize).toFixed(2) + "x",
        // So sánh totalSize (data + index — metric thực tế)
        totalSizeRatio:
          (regStats.totalSize / tsStats.totalSize).toFixed(2) + "x",
        percentSaved: percentDiff.toFixed(1) + "%",
        message,
        breakdown: {
          timeseries_index: fmt(tsStats.indexSize),
          regular_index: fmt(regStats.indexSize),
          index_note:
            "Time-series dùng built-in time index tối ưu, regular cần index riêng cho timestamp queries",
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

/* ======================
   POST /api/records/seed-test

   Mục tiêu: tạo data để SO SÁNH storage time-series vs regular
   
   Điều kiện để time-series nén tốt:
   1. Timestamps TUẦN TỰ, cách nhau đều (không random) → nhiều doc/bucket
   2. Ít countryCode khác nhau → metaField lặp lại nhiều → nén tốt
   3. Giá trị numeric ít biến động → delta encoding hiệu quả
   4. Cùng data insert vào cả 2 collections để so sánh công bằng
====================== */
router.post("/seed-test", authMiddleware, async (req, res) => {
  try {
    const { count = 10000 } = req.body;

    const countries = [
      {
        code: "VN",
        name: "Vietnam",
        capital: "Hanoi",
        flag: "https://flagcdn.com/w320/vn.svg",
      },
      {
        code: "JP",
        name: "Japan",
        capital: "Tokyo",
        flag: "https://flagcdn.com/w320/jp.svg",
      },
      {
        code: "SG",
        name: "Singapore",
        capital: "Singapore",
        flag: "https://flagcdn.com/w320/sg.svg",
      },
    ];

    // Upsert countries_meta
    for (const c of countries) {
      await CountryMeta.findOneAndUpdate(
        { countryCode: c.code },
        {
          countryCode: c.code,
          country: c.name,
          capital: c.capital,
          population: 50000000,
          currency: "USD",
          languages: ["Local"],
          flag: c.flag,
          region: "Asia",
          subregion: "Southeast Asia",
        },
        { upsert: true },
      );
    }

    // Tạo docs với timestamps TUẦN TỰ, cách đều 30 giây
    // → granularity "minutes" → ~2 doc/bucket phút
    // → cùng countryCode luân phiên → metaField lặp lại nhiều
    const docs = [];
    const baseTime = Date.now() - count * 30 * 1000; // bắt đầu từ quá khứ

    for (let i = 0; i < count; i++) {
      const country = countries[i % countries.length]; // luân phiên đều
      docs.push({
        timestamp: new Date(baseTime + i * 30 * 1000), // +30 giây mỗi doc
        meta: {
          userId: req.user.userId,
          countryCode: country.code,
        },
        // Giá trị ít biến động → delta encoding tốt
        temperature: parseFloat((28 + Math.sin(i / 200) * 3).toFixed(2)),
        feelsLike: parseFloat((30 + Math.sin(i / 200) * 3).toFixed(2)),
        humidity: parseFloat((70 + Math.sin(i / 100) * 5).toFixed(2)),
        pressure: parseFloat((1013 + Math.cos(i / 150) * 2).toFixed(2)),
        weatherDescription: i % 10 < 7 ? "clear" : "cloudy",
        pm25: parseFloat((25 + Math.sin(i / 300) * 10).toFixed(2)),
      });
    }

    // Insert cùng data vào cả 2 collections
    const BATCH = 1000;
    for (let i = 0; i < docs.length; i += BATCH) {
      const batch = docs.slice(i, i + BATCH);
      await Promise.all([
        Record.insertMany(batch, { ordered: false }),
        RecordRegular.insertMany(batch, { ordered: false }),
      ]);
    }

    res.json({
      message: `Inserted ${count} docs vào cả 2 collections`,
      strategy:
        "Timestamps tuần tự +30s, 3 countryCode luân phiên, numeric ít biến động",
      hint: "Gọi GET /api/records/storage-compare để xem kết quả",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

router.get("/query-explain", authMiddleware, async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const from = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const to = new Date();
    const userId = req.user.userId;

    // Aggregation explain
    const tsAggExplainArr = await db
      .collection("records_timeseries")
      .aggregate(
        [
          {
            $match: {
              "meta.userId": userId,
              timestamp: { $gte: from, $lte: to },
            },
          },
          { $group: { _id: "$meta.countryCode", avgPM25: { $avg: "$pm25" } } },
        ],
        { explain: true },
      )
      .toArray();

    const regAggExplainArr = await db
      .collection("records_regular")
      .aggregate(
        [
          {
            $match: {
              "meta.userId": userId,
              timestamp: { $gte: from, $lte: to },
            },
          },
          { $group: { _id: "$meta.countryCode", avgPM25: { $avg: "$pm25" } } },
        ],
        { explain: true },
      )
      .toArray();

    const parseAgg = (explainArr) => {
      const explain = Array.isArray(explainArr) ? explainArr[0] : explainArr;
      if (!explain) return null;
      const candidates = [
        explain?.stages?.[0]?.$cursor?.executionStats,
        explain?.stages?.[0]?.executionStats,
        explain?.executionStats,
        explain?.shards
          ? Object.values(explain.shards)[0]?.stages?.[0]?.$cursor
              ?.executionStats
          : null,
      ];
      return (
        candidates.find((p) => p?.executionTimeMillis !== undefined) || null
      );
    };

    const tsStats = parseAgg(tsAggExplainArr);
    const regStats = parseAgg(regAggExplainArr);

    // Fallback hrtime nếu explain không khả dụng
    let tsMs, regMs;
    if (tsStats?.executionTimeMillis !== undefined) {
      tsMs = tsStats.executionTimeMillis;
    } else {
      const t = process.hrtime.bigint();
      await db
        .collection("records_timeseries")
        .aggregate([
          {
            $match: {
              "meta.userId": userId,
              timestamp: { $gte: from, $lte: to },
            },
          },
          { $group: { _id: "$meta.countryCode", avgPM25: { $avg: "$pm25" } } },
        ])
        .toArray();
      tsMs = parseFloat(
        (Number(process.hrtime.bigint() - t) / 1_000_000).toFixed(2),
      );
    }

    if (regStats?.executionTimeMillis !== undefined) {
      regMs = regStats.executionTimeMillis;
    } else {
      const t = process.hrtime.bigint();
      await db
        .collection("records_regular")
        .aggregate([
          {
            $match: {
              "meta.userId": userId,
              timestamp: { $gte: from, $lte: to },
            },
          },
          { $group: { _id: "$meta.countryCode", avgPM25: { $avg: "$pm25" } } },
        ])
        .toArray();
      regMs = parseFloat(
        (Number(process.hrtime.bigint() - t) / 1_000_000).toFixed(2),
      );
    }

    const ratio =
      regMs > tsMs
        ? `Time-series nhanh hơn ${(regMs / tsMs).toFixed(1)}x`
        : `Regular nhanh hơn ${(tsMs / regMs).toFixed(1)}x`;

    res.json({
      aggregation_avg_pm25_by_country: {
        timeseries: {
          executionTimeMs: tsMs,
          docsExamined: tsStats?.totalDocsExamined ?? "N/A",
          docsReturned: tsStats?.nReturned ?? "N/A",
        },
        regular: {
          executionTimeMs: regMs,
          docsExamined: regStats?.totalDocsExamined ?? "N/A",
          docsReturned: regStats?.nReturned ?? "N/A",
        },
        ratio,
        insight: `Time-series chỉ đọc ${tsStats?.totalDocsExamined ?? "?"} buckets thay vì ${regStats?.totalDocsExamined ?? "?"} documents`,
      },
    });
  } catch (err) {
    console.error("query-explain error:", err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
