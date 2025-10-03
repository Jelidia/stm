import fs from "fs";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";

export function loadGtfsIndexes(zipPath) {
  if (!fs.existsSync(zipPath)) {
    throw new Error(`GTFS_ZIP not found: ${zipPath}`);
  }
  const zip = new AdmZip(zipPath);
  const readCsv = (name) => {
    const entry = zip.getEntry(name);
    if (!entry) throw new Error(`Missing ${name} in GTFS zip`);
    const text = zip.readAsText(entry).replace(/^\uFEFF/, ""); // strip BOM
    return parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true });
  };

  const stops = readCsv("stops.txt");
  const routes = readCsv("routes.txt");
  const trips  = readCsv("trips.txt");

  const stopsById   = new Map(stops.map(s => [s.stop_id, s]));
  const stopsByCode = new Map(stops.filter(s => s.stop_code).map(s => [s.stop_code, s]));
  const routesById  = new Map(routes.map(r => [r.route_id, r]));
  const tripsById   = new Map(trips.map(t => [t.trip_id, t]));

  return { stopsById, stopsByCode, routesById, tripsById };
}

export function resolveStop(query, { stopsById, stopsByCode }) {
  if (stopsById.has(query)) return [stopsById.get(query)];
  if (stopsByCode.has(query)) return [stopsByCode.get(query)];
  const q = query.toLowerCase();
  // soft search by name
  const res = [];
  for (const s of stopsById.values()) {
    if (s.stop_name && s.stop_name.toLowerCase().includes(q)) res.push(s);
    if (res.length >= 10) break;
  }
  return res;
}
