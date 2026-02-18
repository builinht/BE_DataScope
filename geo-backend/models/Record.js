const mongoose = require("mongoose");

const recordSchema = new mongoose.Schema(
  {
    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },

    meta: {
      recordId: { type: String, required: true },
      country: { type: String, required: true },
      countryCode: String,
      capital: String,
      population: Number,
      currency: String,
      languages: [String],
      flag: String,
      region: String,
      subregion: String,
      userId: { type: String, required: true },
    },

    // Weather
    temperature: Number,
    feelsLike: Number,
    humidity: Number,
    pressure: Number,
    weatherDescription: String,

    // Air quality
    pm25: Number,
    airQualityStatus: String,
  },
  {
    collection: "records_timeseries",
    timestamps: false,
    timeseries: {
      timeField: "timestamp",
      metaField: "meta",
      granularity: "hours",
    },
  }
);

module.exports = mongoose.model("Record", recordSchema);
