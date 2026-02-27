const mongoose = require("mongoose");

/*
 * Lưu metadata quốc gia riêng biệt
 * → time-series không cần lưu strings dài (flag URL, languages...)
 * → giảm kích thước bucket → nén tốt hơn
 */
const countryMetaSchema = new mongoose.Schema(
  {
    countryCode: { type: String, required: true, unique: true },
    country:     { type: String, required: true },
    capital:     String,
    population:  Number,
    currency:    String,
    languages:   [String],
    flag:        String,
    region:      String,
    subregion:   String,
  },
  {
    collection: "countries_meta",
    timestamps: false,
  }
);

module.exports = mongoose.model("CountryMeta", countryMetaSchema);