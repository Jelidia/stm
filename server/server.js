import "dotenv/config.js";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { loadGtfsIndexes, resolveStop } from "./gtfs.js";
import { getTripUpdates, getVehiclePositions } from "./rt.js";
import { haversineMeters } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const STM_API_KEY = process.env.STM_API_KEY;
const GTFS_ZIP = process.env.GTFS_ZIP || "./data/gtfs_stm.zip";
const PORT = process.env.PORT || 3000;

if (!STM_API_KEY) {
  console.error("Missing STM_API_KEY in .env");
  process.exit(1);
}

console.log("Loading GTFS…", GTFS_ZIP);
const GTFS = loadGtfsIndexes(GTFS_ZIP);
console.log("GTFS loaded: stops=%d, routes=%d, trips=%d",
  GTFS.stopsById.size, GTFS.routesById.size, GTFS.tripsById.size);

// Static site
app.use("/", express.static(path.join(__dirname, "../public")));

app.get("/api/resolve", (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json([]);
  const matches = resolveStop(q, GTFS).map(s => ({
    stop_id: s.stop_id,
    stop_code: s.stop_code || null,
    stop_name: s.stop_name,
    lat: Number(s.stop_lat),
    lon: Number(s.stop_lon)
  }));
  res.json(matches);
});

app.get("/api/stop/:id", async (req, res) => {
  try {
    const max = Math.min(parseInt(req.query.max || "3", 10), 10);
    const q = req.params.id.trim();

    // allow stop_id or stop_code
    const matches = resolveStop(q, GTFS);
    if (!matches.length) return res.status(404).json({ error: "stop_not_found", query: q });

    const stop = matches[0];
    const stopId = stop.stop_id;
    const stopLat = Number(stop.stop_lat);
    const stopLon = Number(stop.stop_lon);

    const [tu, vp] = await Promise.all([
      getTripUpdates(STM_API_KEY),
      getVehiclePositions(STM_API_KEY)
    ]);

    // Index vehicle by trip_id
    const vpByTrip = new Map();
    for (const e of vp.entity) {
      const v = e.vehicle;
      if (v?.trip?.tripId && v.position) vpByTrip.set(v.trip.tripId, v);
    }

    const nowEpoch = Math.floor(Date.now() / 1000);
    const rows = [];
    for (const e of tu.entity) {
      const upd = e.tripUpdate;
      if (!upd) continue;
      const tripId = upd.trip?.tripId;
      if (!tripId) continue;

      // find first STU for this stop
      const stu = (upd.stopTimeUpdate || []).find(x => x.stopId === stopId);
      if (!stu) continue;

      const when = (stu.arrival?.time || stu.departure?.time || 0);
      if (!when || when < nowEpoch - 30) continue;

      const etaSeconds = when - nowEpoch;
      const trip = GTFS.tripsById.get(tripId) || {};
      const route = GTFS.routesById.get(trip.route_id || upd.trip?.routeId) || {};
      const routeName = route.route_short_name || route.route_long_name || (upd.trip?.routeId) || (trip.route_id) || "?";
      const headsign = trip.trip_headsign || upd.trip?.scheduleRelationship || "";

      const veh = vpByTrip.get(tripId);
      let vehicle = null;
      if (veh?.position) {
        const lat = veh.position.latitude;
        const lon = veh.position.longitude;
        const dist = Math.round(haversineMeters(lat, lon, stopLat, stopLon));
        vehicle = {
          id: veh.vehicle?.id || null,
          lat, lon,
          bearing: veh.position?.bearing ?? null,
          distance_m_to_stop: dist,
          occupancy_status: veh.occupancyStatus ?? null
        };
      }

      rows.push({
        eta_seconds: etaSeconds,
        arrival_epoch_utc: when,
        route: routeName,
        headsign,
        trip_id: tripId,
        stop_id: stopId,
        vehicle
      });
    }

    rows.sort((a, b) => a.eta_seconds - b.eta_seconds);

    res.json({
      stop: {
        stop_id: stopId,
        stop_code: stop.stop_code || null,
        stop_name: stop.stop_name,
        lat: stopLat,
        lon: stopLon
      },
      last_updated: new Date().toISOString(),
      arrivals: rows.slice(0, max)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server_error", details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`STM bus app running on http://localhost:${PORT}`);
});
