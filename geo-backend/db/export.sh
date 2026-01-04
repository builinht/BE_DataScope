#!/bin/bash
mongoexport \
  --db geoinsight \
  --collection records \
  --out records.json \
  --jsonArray
echo "Export completed"
