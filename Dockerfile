# ── Stage 1: Build React frontend ────────────────────────────────────────────
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source and static data
COPY api_app.py module.py ./
COPY data/ ./data/

# Copy built frontend from Stage 1
# api_app.py looks for Path(__file__).parent / "frontend" / "dist"
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Render injects $PORT at runtime (default 10000); fall back to 8000 locally
EXPOSE 8000
CMD ["sh", "-c", "uvicorn api_app:app --host 0.0.0.0 --port ${PORT:-8000}"]
