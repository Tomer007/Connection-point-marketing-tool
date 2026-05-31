#!/bin/bash

# Load environment variables from .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | grep -v '^\s*$' | xargs)
fi

echo "🚀 Starting Connection Point..."
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:${SERVER_PORT:-3001}"
echo ""

# Start both BE (Express proxy) and FE (Vite) concurrently
npx concurrently \
  --names "BE,FE" \
  --prefix-colors "cyan,magenta" \
  "npx tsx server/index.ts" \
  "npx vite --port=3000 --host=0.0.0.0"
