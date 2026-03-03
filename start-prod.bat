@echo off
echo Building frontend...
cd frontend && npm run build || pause
cd ..

echo.
echo Starting WeatherRoute on http://localhost:8000
uvicorn api_app:app --host 0.0.0.0 --port 8000
pause
