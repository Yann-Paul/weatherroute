function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** Parse a GPX file in the browser and return the total track distance in km. */
export async function parseGpxTotalKm(file: File): Promise<number> {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return 0;

  let points = Array.from(doc.querySelectorAll("trkpt"));
  if (points.length === 0) points = Array.from(doc.querySelectorAll("wpt"));

  let totalKm = 0;
  for (let i = 1; i < points.length; i++) {
    const lat1 = parseFloat(points[i - 1].getAttribute("lat") ?? "NaN");
    const lon1 = parseFloat(points[i - 1].getAttribute("lon") ?? "NaN");
    const lat2 = parseFloat(points[i].getAttribute("lat") ?? "NaN");
    const lon2 = parseFloat(points[i].getAttribute("lon") ?? "NaN");
    if (!isNaN(lat1) && !isNaN(lon1) && !isNaN(lat2) && !isNaN(lon2)) {
      totalKm += haversineKm(lat1, lon1, lat2, lon2);
    }
  }
  return totalKm;
}
