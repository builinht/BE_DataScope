#!/bin/bash

TOOLS_BIN="/c/Program Files/MongoDB/Tools/100.9.4/bin"
DB_NAME="geoinsight"

BACKUP_NAME=$1

if [ -z "$BACKUP_NAME" ]; then
  echo "Usage: ./restore.sh BACKUP_FOLDER"
  exit 1
fi

BACKUP_PATH="../backup/$BACKUP_NAME/$DB_NAME"

if [ ! -d "$BACKUP_PATH" ]; then
  echo "Backup not found: $BACKUP_PATH"
  exit 1
fi

"$TOOLS_BIN/mongorestore.exe" \
  --db "$DB_NAME" \
  --drop \
  "$BACKUP_PATH"

if [ $? -ne 0 ]; then
  echo "Restore FAILED"
  exit 1
fi

COUNT=$("$TOOLS_BIN/mongosh.exe" --quiet --eval "
use $DB_NAME
db.records.countDocuments()
")

echo "Restore SUCCESS"
echo "records documents: $COUNT"
