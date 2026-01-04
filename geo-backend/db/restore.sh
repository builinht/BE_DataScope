#!/bin/bash
read -p "Enter backup folder name: " FOLDER
mongorestore --db geoinsight ./backup/$FOLDER/geoinsight
echo "Restore completed"
