const mongoose = require("mongoose");

/*
 * ==========================================
 * TIME-SERIES COLLECTION
 * ==========================================
 * meta chỉ có userId + countryCode (gọn nhất)
 * → MongoDB gom nhiều doc vào 1 bucket → nén tốt
 */
const recordSchema = new mongoose.Schema(
  {
    timestamp:          { type: Date, required: true, default: Date.now },
    meta: {
      userId:      { type: String, required: true },
      countryCode: { type: String, required: true },
    },
    temperature:        Number,
    feelsLike:          Number,
    humidity:           Number,
    pressure:           Number,
    weatherDescription: String,
    pm25:               Number,
  },
  {
    collection: "records_timeseries",
    timestamps: false,
    timeseries: {
      timeField:   "timestamp",
      metaField:   "meta",
      granularity: "minutes",
    },
  }
);

/*
 * ==========================================
 * REGULAR COLLECTION — CẤU TRÚC GIỐNG HỆT
 * ==========================================
 * Để so sánh storage CÔNG BẰNG:
 *   Cùng data
 *   Cùng schema/fields
 *   Không thêm index thủ công
 *   Không có time-series bucketing/compression
 */
const regularSchema = new mongoose.Schema(
  {
    timestamp:          { type: Date, default: Date.now },
    meta: {
      userId:      { type: String, required: true },
      countryCode: { type: String, required: true },
    },
    temperature:        Number,
    feelsLike:          Number,
    humidity:           Number,
    pressure:           Number,
    weatherDescription: String,
    pm25:               Number,
  },
  {
    collection: "records_regular",
    timestamps: false,
  }
);

recordSchema.index({ "meta.userId": 1, timestamp: -1 });
regularSchema.index({ "meta.userId": 1, timestamp: -1 });

const Record        = mongoose.model("Record", recordSchema);
const RecordRegular = mongoose.model("RecordRegular", regularSchema);

module.exports = Record;
module.exports.RecordRegular = RecordRegular;