#!/bin/bash
set -e
cd "$(dirname "$0")"
./node_modules/.bin/tsc --project tsconfig.json

