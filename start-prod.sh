#!/bin/bash
# Production: build frontend, then serve everything from FastAPI on port 8000

echo "Building frontend..."
cd frontend && npm run build
cd ..

echo ""
echo "Starting WeatherRoute on http://localhost:8000"
uvicorn api_app:app --host 0.0.0.0 --port 8000
