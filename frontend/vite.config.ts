import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

// Third-party map tile/style hosts used by the map (see src/components/ui/map.tsx
// and src/components/planner/MapLayers.tsx) — cached at runtime so previously
// viewed map areas keep rendering once the trip data itself is offline-capable.
const TILE_HOSTS = [
  "basemaps.cartocdn.com",
  "a.tile.opentopomap.org",
  "b.tile.opentopomap.org",
  "c.tile.opentopomap.org",
  "a.tile-cyclosm.openstreetmap.fr",
  "b.tile-cyclosm.openstreetmap.fr",
  "c.tile-cyclosm.openstreetmap.fr",
  "a.tile.openstreetmap.org",
  "b.tile.openstreetmap.org",
  "c.tile.openstreetmap.org",
];
// Workbox's generateSW mode stringifies urlPattern functions verbatim into
// the built service worker — they can't close over variables from this build
// config. Pre-building a plain RegExp here keeps the host list readable
// while staying self-contained once inlined into sw.js.
const TILE_HOST_PATTERN = new RegExp(
  `^https://(${TILE_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})/`
);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icons/favicon.ico", "icons/apple-touch-icon.png"],
      manifest: {
        name: "WeatherRoute",
        short_name: "WeatherRoute",
        lang: "de",
        description:
          "Plan cycling and travel routes optimised for weather — elevation profiles, temperature forecasts, and multi-stop route planning.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#d67229",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Keep the SW scoped to app-shell navigation; API calls go straight
        // to the network (or fail fast offline) rather than through the SW.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        runtimeCaching: [
          {
            urlPattern: TILE_HOST_PATTERN,
            handler: "CacheFirst",
            options: {
              cacheName: "map-tiles",
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Same-origin ÖPNV transit tile proxy (api_app.py: /api/tiles/oepnv/...).
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith("/api/tiles/oepnv/"),
            handler: "CacheFirst",
            options: {
              cacheName: "transit-tiles",
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
