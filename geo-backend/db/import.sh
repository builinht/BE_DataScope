#!/bin/bash
# import.sh – Import MongoDB JSON Array/Lines, loại _id chính, upsert theo userId
# Windows + Git Bash

if [ -z "$1" ]; then
  echo "Usage: $0 <path_to_json_file>"
  exit 1
fi

FILE="$1"
DB_NAME="geoinsight"
COLLECTION="records"
TOOLS_BIN="/c/Program Files/MongoDB/Tools/100.9.4/bin"

[ ! -f "$FILE" ] && echo "File not found: $FILE" && exit 1

TMP_FILE="./tmp_import.json"

# Python xử lý JSON Array -> JSON Lines, loại _id chính
python - <<EOF
import json
with open("$FILE") as f, open("$TMP_FILE", "w") as out:
    try:
        data = json.load(f)  # nếu là Array
    except:
        # nếu là JSON Lines
        f.seek(0)
        data = [json.loads(line) for line in f if line.strip()]
    for doc in data:
        doc.pop("_id", None)   # chỉ bỏ _id chính
        out.write(json.dumps(doc) + "\n")
EOF

echo "Importing $FILE into $DB_NAME.$COLLECTION (upsert mode)..."

"$TOOLS_BIN/mongoimport.exe" \
  --db "$DB_NAME" \
  --collection "$COLLECTION" \
  --file "$TMP_FILE" \
  --upsert \
  --upsertFields userId

rm "$TMP_FILE"
echo "Import completed!"
