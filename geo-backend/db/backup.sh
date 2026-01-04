#!/bin/bash

MONGO_BIN="/c/Program Files/MongoDB/Server/8.2/bin"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="../backup/$DATE"

mkdir -p "$BACKUP_DIR"

"$MONGO_BIN/mongodump.exe" \
  --db geoinsight \
  --out "$BACKUP_DIR"

if [ $? -eq 0 ]; then
  echo "Backup SUCCESS at $DATE"
  echo "Location: $BACKUP_DIR"
else
  echo "Backup FAILED"
fi

