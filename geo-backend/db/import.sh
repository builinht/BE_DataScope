#!/bin/bash
mongoimport \
  --db geoinsight \
  --collection records \
  --file records.json \
  --jsonArray
echo "Import completed"
