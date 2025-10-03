// server/gtfs.js
import fs from "fs";
import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { parseGtfsTime, yyyymmdd, gtfsDow } from "./utils.js";

export function loadGtfsIndexes(zipPath) {
    if (!fs.existsSync(zipPath)) throw new Error(`GTFS_ZIP not found: ${zipPath}`);
    const zip = new AdmZip(zipPath);
    const readCsv = (name) => {
        const entry = zip.getEntry(name);
        if (!entry) throw new Error(`Missing ${name} in GTFS zip`);
        const text = zip.readAsText(entry).replace(/^\uFEFF/, "");
        return parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true });
    };

    const stops = readCsv("stops.txt");
    const routes = readCsv("routes.txt");
    const trips = readCsv("trips.txt");
    const cal = safeRead(zip, "calendar.txt");
    const calEx = safeRead(zip, "calendar_dates.txt");
    const stTimes = readCsv("stop_times.txt"); // We build a per-stop index (few seconds, but worth it)

    const isBoardable = (s) => !s.location_type || s.location_type === "0";

    const stopsById = new Map(stops.map(s => [s.stop_id, s]));
    const stopsByCode = new Map(stops.filter(s => s.stop_code && isBoardable(s)).map(s => [s.stop_code, s]));
    const routesById = new Map(routes.map(r => [r.route_id, r]));
    const tripsById = new Map(trips.map(t => [t.trip_id, t]));

    // parent -> children
    const byParent = new Map();
    for (const s of stops) {
        if (s.parent_station) {
            if (!byParent.has(s.parent_station)) byParent.set(s.parent_station, []);
            byParent.get(s.parent_station).push(s);
        }
    }

    // calendar maps
    const calByService = new Map();
    for (const c of cal) calByService.set(c.service_id, c);

    const calExByService = new Map();
    for (const cx of calEx) {
        if (!calExByService.has(cx.service_id)) calExByService.set(cx.service_id, new Map());
        calExByService.get(cx.service_id).set(cx.date, cx.exception_type); // 1=add, 2=remove
    }

    // stop_times index: stop_id -> [{trip_id, arr, dep, seq}]
    const stopTimesByStop = new Map();
    for (const row of stTimes) {
        const sid = row.stop_id;
        if (!stopTimesByStop.has(sid)) stopTimesByStop.set(sid, []);
        stopTimesByStop.get(sid).push({
            trip_id: row.trip_id,
            arr: parseGtfsTime(row.arrival_time),
            dep: parseGtfsTime(row.departure_time),
            seq: parseInt(row.stop_sequence, 10) || 0
        });
    }
    // sort by sequence/time for faster queries
    for (const list of stopTimesByStop.values()) list.sort((a, b) => (a.dep ?? a.arr) - (b.dep ?? b.arr));

    return {
        allStops: stops,
        stopsById, stopsByCode,
        routesById, tripsById,
        byParent, isBoardable,
        stopTimesByStop,
        calByService, calExByService
    };
}

function safeRead(zip, name) {
    const entry = zip.getEntry(name);
    if (!entry) return [];
    const text = zip.readAsText(entry).replace(/^\uFEFF/, "");
    return parse(text, { columns: true, skip_empty_lines: true, relax_quotes: true });
}

export function resolveStop(query, GTFS) {
    const { stopsById, stopsByCode, allStops, isBoardable } = GTFS;

    if (stopsByCode.has(query)) return [stopsByCode.get(query)];     // numeric code → boardable
    if (stopsById.has(query) && isBoardable(stopsById.get(query))) return [stopsById.get(query)];

    // fuzzy over boardable stops
    const q = query.toLowerCase();
    const res = [];
    for (const s of allStops) {
        if (!isBoardable(s)) continue;
        if ((s.stop_name || "").toLowerCase().includes(q) || (s.stop_code || "") === query) {
            res.push(s);
            if (res.length >= 10) break;
        }
    }
    return res;
}

export function siblingBoardableStops(stop, GTFS) {
    const out = [];
    const { byParent, allStops, isBoardable } = GTFS;
    if (stop.parent_station && byParent.has(stop.parent_station)) {
        for (const s of byParent.get(stop.parent_station)) if (isBoardable(s)) out.push(s);
    }
    if (stop.stop_code) {
        for (const s of allStops) {
            if (isBoardable(s) && s.stop_code === stop.stop_code && s.stop_id !== stop.stop_id) out.push(s);
        }
    }
    return out;
}

// Is a service_id active on a given local date?
export function isServiceActive(service_id, date, GTFS) {
    const { calByService, calExByService } = GTFS;
    const ds = yyyymmdd(date);
    const ex = calExByService.get(service_id)?.get(ds);
    if (ex === "2") return false;       // removed
    if (ex === "1") return true;        // added

    const c = calByService.get(service_id);
    if (!c) return false;
    if (ds < c.start_date || ds > c.end_date) return false;

    const dow = gtfsDow(date); // 0=Sun
    const map = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return c[map[dow]] === "1";
}

// Next scheduled departures for a stop (no realtime)
export function nextScheduledByStop(stop_id, GTFS, nowLocal = new Date(), max = 5) {
    const list = GTFS.stopTimesByStop.get(stop_id);
    if (!list || !list.length) return [];
    const midnight = new Date(nowLocal);
    midnight.setHours(0, 0, 0, 0);
    const nowSec = Math.floor((nowLocal - midnight) / 1000);

    const out = [];
    for (const st of list) {
        const trip = GTFS.tripsById.get(st.trip_id); if (!trip) continue;
        if (!isServiceActive(trip.service_id, nowLocal, GTFS)) continue;

        const t = (st.dep ?? st.arr ?? null); if (t == null) continue;
        const whenEpoch = Math.floor(midnight.getTime() / 1000) + t;  // supports >24h
        if (whenEpoch < Math.floor(nowLocal.getTime() / 1000) - 30) continue;

        const route = GTFS.routesById.get(trip.route_id) || {};
        const routeName = route.route_short_name || route.route_long_name || route.route_id || "?";

        out.push({
            eta_seconds: whenEpoch - Math.floor(nowLocal.getTime() / 1000),
            arrival_epoch_utc: whenEpoch, // still local-midnight based; UI treats as local clock
            route: routeName,
            headsign: trip.trip_headsign || "",
            trip_id: trip.trip_id,
            stop_id
        });
        if (out.length >= max) break;
    }
    return out.sort((a, b) => a.arrival_epoch_utc - b.arrival_epoch_utc).slice(0, max);
}
