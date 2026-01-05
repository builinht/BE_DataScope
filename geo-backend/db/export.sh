#!/bin/bash
# export.sh

# Cấu hình
TOOLS_BIN="/c/Program Files/MongoDB/Tools/100.9.4/bin"
DB_NAME="geoinsight"
COLLECTION="records"

# Timestamp để export file không trùng
DATE=$(date +"%Y%m%d_%H%M%S")
OUT_DIR="../data/export"
OUT_FILE="$OUT_DIR/${COLLECTION}_$DATE.json"

# Tạo folder nếu chưa có
mkdir -p "$OUT_DIR"

# Lấy số document
COUNT=$("$TOOLS_BIN/mongosh.exe" --quiet --eval "db.getSiblingDB('$DB_NAME').$COLLECTION.countDocuments()")

if [ "$COUNT" -eq 0 ]; then
  echo "Collection '$COLLECTION' has NO DATA"
  exit 1
fi

# Export collection
"$TOOLS_BIN/mongoexport.exe" \
  --db "$DB_NAME" \
  --collection "$COLLECTION" \
  --out "$OUT_FILE" \
  --jsonArray

# 🔹 Kiểm tra kết quả export
if [ $? -ne 0 ] || [ ! -s "$OUT_FILE" ]; then
  echo "Export FAILED"
  exit 1
fi

echo "Export SUCCESS"
echo "File: $OUT_FILE"
echo "Documents exported: $COUNT"
