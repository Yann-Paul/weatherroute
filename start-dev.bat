@echo off
echo Starting WeatherRoute in development mode...
echo   Backend:  http://localhost:8000
echo   Frontend: http://localhost:5173
echo.

start "WeatherRoute Backend" cmd /k "uvicorn api_app:app --reload"
cd frontend && start "WeatherRoute Frontend" cmd /k "npx vite"
