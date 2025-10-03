// server/server.js
import "dotenv/config.js";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { loadGtfsIndexes, resolveStop, siblingBoardableStops, nextScheduledByStop } from "./gtfs.js";
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
console.log("GTFS loaded: stops=%d, routes=%d, trips=%d", GTFS.stopsById.size, GTFS.routesById.size, GTFS.tripsById.size);

// Static site
app.use("/", express.static(path.join(__dirname, "../public")));

// Quick inspector
app.get("/api/inspect/:q", (req, res) => {
    const q = (req.params.q || "").trim();
    const matches = resolveStop(q, GTFS);
    const all = matches.map(s => ({
        stop_id: s.stop_id, stop_code: s.stop_code || null, stop_name: s.stop_name,
        location_type: s.location_type || "0", parent_station: s.parent_station || null,
        boardable: GTFS.isBoardable(s)
    }));
    res.json(all);
});

app.get("/api/resolve", (req, res) => {
    const q = (req.query.q || "").toString().trim();
    if (!q) return res.json([]);
    const matches = resolveStop(q, GTFS).map(s => ({
        stop_id: s.stop_id, stop_code: s.stop_code || null, stop_name: s.stop_name,
        lat: Number(s.stop_lat), lon: Number(s.stop_lon)
    }));
    res.json(matches);
});

app.get("/api/stop/:id", async (req, res) => {
    try {
        const max = Math.min(parseInt(req.query.max || "5", 10), 10);
        const q = req.params.id.trim();

        const matches = resolveStop(q, GTFS);
        if (!matches.length) return res.status(404).json({ error: "stop_not_found", query: q });

        const base = matches[0];
        const stopLat = Number(base.stop_lat);
        const stopLon = Number(base.stop_lon);

        const candidates = new Set([base.stop_id]);
        for (const s of siblingBoardableStops(base, GTFS)) candidates.add(s.stop_id);
        if (base.stop_code) candidates.add(base.stop_code);

        const [tu, vp] = await Promise.all([getTripUpdates(STM_API_KEY), getVehiclePositions(STM_API_KEY)]);

        // Index vehicle by trip_id
        const vpByTrip = new Map();
        for (const e of vp.entity) {
            const v = e.vehicle;
            if (v?.trip?.tripId && v.position) vpByTrip.set(v.trip.tripId, v);
        }

        const nowEpoch = Math.floor(Date.now() / 1000);
        const rtRows = [];
        for (const e of tu.entity) {
            const upd = e.tripUpdate; if (!upd) continue;
            const tripId = upd.trip?.tripId; if (!tripId) continue;
            const stu = (upd.stopTimeUpdate || []).find(x => candidates.has(x.stopId));
            if (!stu) continue;
            const when = (stu.arrival?.time || stu.departure?.time || 0);
            if (!when || when < nowEpoch - 30) continue;

            const trip = GTFS.tripsById.get(tripId) || {};
            const route = GTFS.routesById.get(trip.route_id || upd.trip?.routeId) || {};
            const routeName = route.route_short_name || route.route_long_name || upd.trip?.routeId || trip.route_id || "?";
            const headsign = trip.trip_headsign || "";

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

            rtRows.push({
                eta_seconds: when - nowEpoch,
                arrival_epoch_utc: when,
                route: routeName,
                headsign,
                trip_id: tripId,
                stop_id: base.stop_id,
                vehicle
            });
        }
        rtRows.sort((a, b) => a.eta_seconds - b.eta_seconds);

        let source = "realtime";
        let note = null;
        let rows = rtRows.slice(0, max);

        if (!rows.length) {
            // fallback to schedule (on chosen stop + siblings)
            const sched = [];
            for (const sid of candidates) {
                // Only use stop_ids in schedule
                if (GTFS.stopsById.has(sid)) {
                    sched.push(...nextScheduledByStop(sid, GTFS, new Date(), max));
                }
            }
            sched.sort((a, b) => a.arrival_epoch_utc - b.arrival_epoch_utc);
            rows = sched.slice(0, max);
            source = rows.length ? "schedule" : "none";

            // guidance note if user picked an entrance/station
            if (!GTFS.isBoardable(base)) {
                note = `“${base.stop_name}” (${base.stop_code || base.stop_id}) is not a boardable stop (location_type=${base.location_type || "2"}). Showing boardable siblings/schedule instead.`;
            }
        }

        res.json({
            stop: {
                stop_id: base.stop_id,
                stop_code: base.stop_code || null,
                stop_name: base.stop_name,
                lat: stopLat, lon: stopLon,
                boardable: GTFS.isBoardable(base)
            },
            source, note,
            last_updated: new Date().toISOString(),
            arrivals: rows
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "server_error", details: String(err) });
    }
});

app.listen(PORT, () => {
    console.log(`STM bus app running on http://localhost:${PORT}`);
});
