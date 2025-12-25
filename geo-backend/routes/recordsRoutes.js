const express = require("express");
const Record = require("../models/Record");
const axios = require("axios");
const { body, validationResult } = require("express-validator");

const router = express.Router();

// Middleware: API Key Validation
const apiKeyMiddleware = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== process.env.BACKEND_API_KEY) {
    return res.status(401).json({ message: "Invalid API key" });
  }
  next();
};

// Helper: Extract userId from JWT
function getUserIdFromReq(req) {
  try {
    if (req.auth?.payload?.sub) return req.auth.payload.sub;
    if (req.auth?.sub) return req.auth.sub;
    if (req.user?.sub) return req.user.sub;
  } catch (err) {}
  return null;
}

// Helper: OpenAQ headers
const getOpenAQHeaders = () => {
  const key = process.env.OPENAQ_API_KEY;
  const headers = {
    Accept: "application/json",
    "User-Agent": "GeoInsight/1.0"
  };
  if (key) {
    headers["X-API-Key"] = key;
  }
  return headers;
};

// Helper: Get AQI status from PM2.5 value
const getAQIStatus = (value, parameter = 'pm25') => {
  if (typeof value !== "number" || isNaN(value)) return "Unknown";
  
  // PM2.5 thresholds (µg/m³)
  if (parameter.toLowerCase().includes('pm25') || parameter.toLowerCase().includes('pm2.5')) {
    if (value <= 12) return "Good";
    if (value <= 35.4) return "Moderate";
    if (value <= 55.4) return "Unhealthy for Sensitive";
    if (value <= 150.4) return "Unhealthy";
    if (value <= 250.4) return "Very Unhealthy";
    return "Hazardous";
  }
  
  // PM10 thresholds
  if (parameter.toLowerCase().includes('pm10')) {
    if (value <= 54) return "Good";
    if (value <= 154) return "Moderate";
    if (value <= 254) return "Unhealthy for Sensitive";
    if (value <= 354) return "Unhealthy";
    if (value <= 424) return "Very Unhealthy";
    return "Hazardous";
  }
  
  // Generic thresholds for other parameters
  if (value <= 50) return "Good";
  if (value <= 100) return "Moderate";
  if (value <= 150) return "Unhealthy for Sensitive";
  if (value <= 200) return "Unhealthy";
  if (value <= 300) return "Very Unhealthy";
  return "Hazardous";
};

/** -----------------------------
 * POST /api/records
 * Save a snapshot record
 * ----------------------------- */
router.post(
  "/",
  apiKeyMiddleware,
  body("country").notEmpty().withMessage("country is required"),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const userId = getUserIdFromReq(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized: user not found" });

      const bodyData = req.body || {};
      const airQualityArray = Array.isArray(bodyData.airQuality)
        ? bodyData.airQuality
        : bodyData.airQuality
        ? [bodyData.airQuality]
        : [];

      const recordData = {
        country: bodyData.country,
        userId,
        metadata: bodyData.metadata || {},
        weather: bodyData.weather || {},
        airQuality: airQualityArray,
        fetchedAt: bodyData.fetchedAt ? new Date(bodyData.fetchedAt) : new Date(),
      };

      const saved = await new Record(recordData).save();
      return res.status(201).json(saved);
    } catch (err) {
      console.error("Create record error:", err);
      return res.status(500).json({ message: "Failed to save record" });
    }
  }
);

/** -----------------------------
 * GET /api/records
 * Get all records for user
 * ----------------------------- */
router.get("/", apiKeyMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized: user not found" });

    const records = await Record.find({ userId }).sort({ createdAt: -1 });
    return res.json(records);
  } catch (err) {
    console.error("Fetch records error:", err);
    return res.status(500).json({ message: "Failed to fetch records" });
  }
});

/** -----------------------------
 * GET /api/records/stats
 * Get basic stats for user
 * ----------------------------- */
router.get("/stats", apiKeyMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized: user not found" });

    const totalRecords = await Record.countDocuments({ userId });
    const uniqueCountries = await Record.distinct("country", { userId });

    return res.json({
      totalRecords,
      uniqueCountriesCount: uniqueCountries.length,
    });
  } catch (err) {
    console.error("Stats fetch error:", err);
    return res.status(500).json({ message: "Failed to fetch statistics" });
  }
});

/** -----------------------------
 * DELETE /api/records/:id
 * Delete user-owned record
 * ----------------------------- */
router.delete("/:id", apiKeyMiddleware, async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized: user not found" });

    const record = await Record.findById(req.params.id);
    if (!record) return res.status(404).json({ message: "Record not found" });
    if (record.userId !== userId) return res.status(403).json({ message: "Forbidden: not your record" });

    await record.deleteOne();
    return res.json({ message: "Record deleted successfully" });
  } catch (err) {
    console.error("Delete record error:", err);
    return res.status(500).json({ message: "Failed to delete record" });
  }
});

/** -----------------------------
 * GET /api/records/geo/airquality
 * Fetch OpenAQ v3 air quality data
 * Query params: lat, lon OR city, country
 * ----------------------------- */
router.get("/geo/airquality", apiKeyMiddleware, async (req, res) => {
  try {
    const { lat, lon, city, country } = req.query;
    const headers = getOpenAQHeaders();
    
    // Check if API key is configured
    const hasApiKey = !!process.env.OPENAQ_API_KEY;
    
    let locationData = null;
    let measurements = [];
    let fallbackUsed = false;

    // Strategy 1: Search by coordinates (preferred)
    if (lat && lon) {
      try {
        console.log(`🔍 Searching OpenAQ by coordinates: ${lat}, ${lon}`);
        
        const radius = 25000; // 25km radius (API maximum)
        const locationsUrl = `https://api.openaq.org/v3/locations`;
        const locationsParams = {
          coordinates: `${lat},${lon}`,
          radius,
          limit: 10
        };

        const locationsResponse = await axios.get(locationsUrl, {
          headers,
          params: locationsParams,
          timeout: 10000
        });

        const locations = locationsResponse.data?.results || [];
        console.log(`✅ Found ${locations.length} locations near coordinates`);

        if (locations.length > 0) {
          locationData = locations[0];
          
          // Fetch latest measurements for this location
          if (locationData.id) {
            try {
              const latestUrl = `https://api.openaq.org/v3/locations/${locationData.id}/latest`;
              console.log(`📊 Fetching measurements for location ID: ${locationData.id}`);
              
              const latestResponse = await axios.get(latestUrl, {
                headers,
                timeout: 10000
              });

              measurements = latestResponse.data?.results || [];
              console.log(`✅ Retrieved ${measurements.length} measurements`);
            } catch (latestErr) {
              console.warn('Failed to fetch latest measurements:', latestErr.message);
            }
          }
        }
      } catch (coordErr) {
        console.warn('Coordinate-based search failed:', coordErr.message);
        fallbackUsed = true;
      }
    }

    // Strategy 2: Search by country code (fallback)
    if (measurements.length === 0 && country) {
      try {
        console.log(`🔍 Searching OpenAQ by country code: ${country}`);
        
        const locationsUrl = `https://api.openaq.org/v3/locations`;
        const locationsParams = {
          iso: country.toUpperCase(), // Use 'iso' parameter, not 'countries'
          limit: 10
        };

        const locationsResponse = await axios.get(locationsUrl, {
          headers,
          params: locationsParams,
          timeout: 10000
        });

        const locations = locationsResponse.data?.results || [];
        console.log(`✅ Found ${locations.length} locations in ${country}`);

        if (locations.length > 0) {
          // Try to find location near the capital/city if provided
          let targetLocation = locations[0];
          
          if (city) {
            const cityMatch = locations.find(loc => 
              loc.locality?.toLowerCase().includes(city.toLowerCase()) ||
              loc.name?.toLowerCase().includes(city.toLowerCase())
            );
            if (cityMatch) {
              targetLocation = cityMatch;
              console.log(`✅ Found location matching city: ${city}`);
            }
          }

          locationData = targetLocation;
          fallbackUsed = true;

          // Fetch latest measurements
          if (locationData.id) {
            try {
              const latestUrl = `https://api.openaq.org/v3/locations/${locationData.id}/latest`;
              console.log(`📊 Fetching measurements for location ID: ${locationData.id}`);
              
              const latestResponse = await axios.get(latestUrl, {
                headers,
                timeout: 10000
              });

              measurements = latestResponse.data?.results || [];
              console.log(`✅ Retrieved ${measurements.length} measurements`);
            } catch (latestErr) {
              console.warn('Failed to fetch latest measurements:', latestErr.message);
            }
          }
        }
      } catch (countryErr) {
        console.warn('Country-based search failed:', countryErr.message);
      }
    }

    // Transform measurements to our format
    const transformedMeasurements = measurements
      .filter(m => m.value != null && !isNaN(Number(m.value)))
      .map(measurement => {
        // Handle both nested and flat parameter structures
        const paramName = measurement.parameter?.name || measurement.parameter || 'PM2.5';
        const paramValue = Number(measurement.value);
        
        return {
          parameter: paramName,
          value: paramValue,
          unit: measurement.unit || measurement.parameter?.units || 'µg/m³',
          status: getAQIStatus(paramValue, paramName),
          measuredAt: measurement.datetime?.utc || measurement.datetime || measurement.date?.utc || new Date().toISOString(),
          locationName: locationData?.name || locationData?.locality || city || 'Unknown Location',
          coordinates: locationData?.coordinates || null
        };
      });

    // Return response
    if (transformedMeasurements.length === 0) {
      return res.json({
        results: [],
        fallback: true,
        message: hasApiKey 
          ? 'No air quality monitoring stations found for this location'
          : 'OpenAQ API key not configured - air quality data unavailable',
        location: locationData ? {
          name: locationData.name,
          city: locationData.locality || city,
          country: locationData.country || country,
          coordinates: locationData.coordinates
        } : null,
        requiresApiKey: !hasApiKey
      });
    }

    return res.json({
      results: transformedMeasurements,
      fallback: fallbackUsed,
      location: {
        name: locationData?.name,
        city: locationData?.locality || city,
        country: locationData?.country || country,
        coordinates: locationData?.coordinates
      }
    });

  } catch (err) {
    console.error('❌ Air quality endpoint error:', err.message);
    
    // Check if it's an authentication error
    if (err.response?.status === 401 || err.response?.status === 403) {
      return res.json({
        results: [],
        fallback: true,
        message: 'OpenAQ API authentication required. Please configure OPENAQ_API_KEY.',
        requiresApiKey: true,
        error: 'Authentication failed'
      });
    }

    // Return empty results for any other error to keep app functional
    return res.json({
      results: [],
      fallback: true,
      message: 'Air quality data temporarily unavailable',
      error: err.message
    });
  }
});

/** -----------------------------
 * DEPRECATED: Old proxy endpoint (kept for backward compatibility)
 * Use /geo/airquality instead
 * ----------------------------- */
router.get("/geo/airquality/proxy", apiKeyMiddleware, async (req, res) => {
  console.warn('⚠️  Deprecated endpoint used: /geo/airquality/proxy - use /geo/airquality instead');
  
  // Redirect to new endpoint
  const queryString = new URLSearchParams(req.query).toString();
  const newUrl = `/api/records/geo/airquality${queryString ? '?' + queryString : ''}`;
  
  return res.redirect(307, newUrl);
});

module.exports = router;