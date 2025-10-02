#!/usr/bin/env python3
"""
STM Bus CLI — next arrivals and live vehicle distance for a given stop.

Usage:
  export STM_API_KEY="..."
  python stm_next.py --gtfs /path/to/gtfs.zip --stop 52552
"""

import argparse, csv, io, os, sys, zipfile, math, json
from datetime import datetime, timezone
import requests
from google.transit import gtfs_realtime_pb2

API_BASE_RT = "https://api.stm.info/pub/od/gtfs-rt/ic/v2"

def read_csv_from_gtfs(gtfs_path, filename):
    """Return rows from a GTFS CSV either inside a ZIP or from a folder."""
    if gtfs_path.lower().endswith(".zip"):
        with zipfile.ZipFile(gtfs_path) as zf:
            with zf.open(filename) as f:
                text = io.TextIOWrapper(f, encoding="utf-8-sig", newline="")
                return list(csv.DictReader(text))
    else:
        with open(os.path.join(gtfs_path, filename), "r", encoding="utf-8-sig", newline="") as f:
            return list(csv.DictReader(f))

def haversine_meters(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlmb/2)**2
    return 2*R*math.asin(math.sqrt(a))

def load_static(gtfs_path):
    stops = read_csv_from_gtfs(gtfs_path, "stops.txt")
    trips = read_csv_from_gtfs(gtfs_path, "trips.txt")
    routes = read_csv_from_gtfs(gtfs_path, "routes.txt")

    trips_by_id = {t["trip_id"]: t for t in trips}
    routes_by_id = {r["route_id"]: r for r in routes}
    stops_by_id  = {s["stop_id"]: s for s in stops}

    # Also index by stop_code and lowercased stop_name
    by_code = {s.get("stop_code", ""): s for s in stops if s.get("stop_code")}
    by_name = {}
    for s in stops:
        by_name.setdefault(s["stop_name"].strip().lower(), []).append(s)

    return stops_by_id, by_code, by_name, trips_by_id, routes_by_id

def find_stop(query, stops_by_id, by_code, by_name):
    q = query.strip()
    # Exact stop_id
    if q in stops_by_id:
        return [stops_by_id[q]]
    # Exact stop_code
    if q in by_code:
        return [by_code[q]]
    # Case-insensitive full name
    key = q.lower()
    if key in by_name:
        return by_name[key]
    # Substring search
    results = [s for s in stops_by_id.values() if key in s["stop_name"].lower()]
    return results

def fetch_feed(url, api_key):
    headers = {"accept": "application/x-protobuf", "apiKey": api_key}
    res = requests.get(url, headers=headers, timeout=12)
    res.raise_for_status()
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(res.content)
    return feed

def best_arrivals_for_stop(stop_id, trips_by_id, routes_by_id, tu_feed, vp_feed, stop_lat=None, stop_lon=None, limit=3):
    now = datetime.now(timezone.utc).timestamp()
    # Build trip_id -> vehicle position
    vp_by_trip = {}
    for e in vp_feed.entity:
        if e.HasField("vehicle") and e.vehicle.HasField("trip"):
            vp_by_trip[e.vehicle.trip.trip_id] = e.vehicle

    rows = []
    for ent in tu_feed.entity:
        if not ent.HasField("trip_update"):
            continue
        tu = ent.trip_update
        trip_id = tu.trip.trip_id

        # Find the first StopTimeUpdate for this stop
        for stu in tu.stop_time_update:
            if stu.stop_id != stop_id:
                continue

            # ETA source: arrival.time then departure.time
            when = None
            if stu.arrival.HasField("time"):
                when = stu.arrival.time
            elif stu.departure.HasField("time"):
                when = stu.departure.time
            if not when:
                continue

            # Drop already-passed predictions (allow small lag)
            if when < now - 30:
                continue

            eta_s = int(round(when - now))
            trip = trips_by_id.get(trip_id, {})
            route = routes_by_id.get(trip.get("route_id",""), {})
            route_name = route.get("route_short_name") or route.get("route_long_name") or route.get("route_id")
            headsign = trip.get("trip_headsign") or ""

            veh = vp_by_trip.get(trip_id)
            vehicle_info = None
            if veh and veh.HasField("position"):
                lat = veh.position.latitude
                lon = veh.position.longitude
                dist_m = None
                if stop_lat is not None and stop_lon is not None:
                    try:
                        dist_m = int(haversine_meters(lat, lon, float(stop_lat), float(stop_lon)))
                    except Exception:
                        dist_m = None
                vehicle_info = {
                    "lat": lat, "lon": lon,
                    "bearing": veh.position.bearing if veh.position.HasField("bearing") else None,
                    "distance_m_to_stop": dist_m,
                    "occupancy_status": veh.occupancy_status if veh.HasField("occupancy_status") else None,
                    "id": (veh.vehicle.id if veh.HasField("vehicle") else None)
                }

            rows.append({
                "eta_seconds": eta_s,
                "arrival_epoch_utc": int(when),
                "trip_id": trip_id,
                "route": route_name,
                "headsign": headsign,
                "vehicle": vehicle_info
            })
            break  # Only first STU match per trip

    rows.sort(key=lambda r: r["eta_seconds"])
    return rows[:limit]

def format_eta(seconds):
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    rem = seconds % 60
    return f"{minutes} min {rem:02d}s"

def main():
    ap = argparse.ArgumentParser(description="STM: next buses for a stop (with live vehicle distance).")
    ap.add_argument("--gtfs", required=True, help="Path to STM GTFS ZIP or folder (static).")
    ap.add_argument("--stop", required=True, help="Stop code, stop_id, or stop name.")
    ap.add_argument("--max", type=int, default=3, help="Max results (default 3).")
    ap.add_argument("--json", action="store_true", help="Output JSON instead of human text.")
    ap.add_argument("--api-key", default=os.getenv("STM_API_KEY"), help="STM API key or env STM_API_KEY.")
    args = ap.parse_args()

    if not args.api_key:
        print("Missing API key. Use --api-key or set env STM_API_KEY.", file=sys.stderr)
        sys.exit(2)

    # Load static GTFS indexes
    stops_by_id, by_code, by_name, trips_by_id, routes_by_id = load_static(args.gtfs)

    # Resolve stop
    matches = find_stop(args.stop, stops_by_id, by_code, by_name)
    if not matches:
        print(f"No stop found for query: {args.stop}", file=sys.stderr)
        sys.exit(1)
    stop = matches[0]
    stop_name = stop["stop_name"]
    stop_id = stop["stop_id"]
    stop_code = stop.get("stop_code","")
    stop_lat = float(stop["stop_lat"])
    stop_lon = float(stop["stop_lon"])

    # Fetch realtime feeds
    try:
        tu = fetch_feed(f"{API_BASE_RT}/tripUpdates", args.api_key)
        vp = fetch_feed(f"{API_BASE_RT}/vehiclePositions", args.api_key)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else "?"
        body = e.response.text if e.response is not None else ""
        print(f"Realtime request failed ({status}). {body}", file=sys.stderr)
        sys.exit(3)

    results = best_arrivals_for_stop(stop_id, trips_by_id, routes_by_id, tu, vp, stop_lat, stop_lon, limit=args.max)

    if args.json:
        payload = {
            "stop": {"stop_id": stop_id, "stop_code": stop_code, "stop_name": stop_name, "lat": stop_lat, "lon": stop_lon},
            "generated_at": datetime.now().astimezone().isoformat(),
            "arrivals": results
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    # Human-readable
    now = datetime.now().astimezone()
    print(f"Now:  {now.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(f"Stop: {stop_name} (stop_id={stop_id}, code={stop_code})")
    print(f"Loc:  {stop_lat:.6f},{stop_lon:.6f}")
    print()

    if results:
        for r in results:
            eta = format_eta(max(0, r["eta_seconds"]))
            when_local = datetime.fromtimestamp(r["arrival_epoch_utc"], tz=timezone.utc).astimezone()
            v = r["vehicle"]
            where = "unknown"
            if v and (v.get("lat") is not None) and (v.get("lon") is not None):
                if v.get("distance_m_to_stop") is not None:
                    where = f"{v['lat']:.6f},{v['lon']:.6f} (~{v['distance_m_to_stop']} m away)"
                else:
                    where = f"{v['lat']:.6f},{v['lon']:.6f}"
            print(f"• Route {r['route']} → {r['headsign']}  |  ETA: {eta}  (at {when_local.strftime('%H:%M:%S')})")
            print(f"  Vehicle: {where}")
        print()
    else:
        print("No realtime arrivals found for this stop right now.")
        print("Tip: Late night? Service ended? Or predictions temporarily unavailable.")
        print()

if __name__ == "__main__":
    main()
