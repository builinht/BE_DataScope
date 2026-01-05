#!/bin/bash

TOOLS_BIN="/c/Program Files/MongoDB/Tools/100.9.4/bin"
DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="../backup/$DATE"

mkdir -p "$BACKUP_DIR"

"$TOOLS_BIN/mongodump.exe" \
  --db geoinsight \
  --out "$BACKUP_DIR"

if [ $? -eq 0 ]; then
  echo "Backup SUCCESS at $DATE"
  echo "Location: $BACKUP_DIR"
else
  echo "Backup FAILED"
fi

