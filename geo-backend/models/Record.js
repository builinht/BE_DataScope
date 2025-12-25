const mongoose = require("mongoose");

const recordSchema = new mongoose.Schema(
  {
    country: { type: String, required: true },
    userId: { type: String, required: true }, // Add user ID field
    metadata: {
      capital: String,
      population: Number,
      currency: String,
      languages: [String],
      flag: String,
      region: String,
      subregion: String
    },
    weather: {
      temperature: Number,
      humidity: Number,
      description: String,
      feelsLike: Number,
      pressure: Number
    },
    airQuality: [
      {
        parameter: { type: String },
        value: { type: Number },
        unit: { type: String },
        status: { type: String },
      }
  ],
    fetchedAt: { type: Date } // Add fetchedAt field
  },
  { timestamps: true } // automatically adds createdAt and updatedAt
);

// Index for better query performance
recordSchema.index({ userId: 1, createdAt: -1 });
recordSchema.index({ userId: 1, country: 1 });

const Record = mongoose.model("Record", recordSchema);

module.exports = Record;