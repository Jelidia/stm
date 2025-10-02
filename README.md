# STM Bus CLI — Next Arrivals + Live Vehicle Distance

Simple command-line tool for Montréal STM buses. Give it a **bus stop** (code, `stop_id`, or name), and it prints:
- Next predicted arrivals (from **GTFS-Realtime TripUpdates**)
- Where the bus is right now (from **VehiclePositions**), and approx **distance to your stop**
- How many minutes you have to get there

> **Note**: This is **bus only**. Métro real-time ETAs are not published via STM GTFS-Realtime.

## Quick start

1) **Install Python 3.9+** and dependencies:
```bash
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

2) **Export your STM API key** (Public key from the STM developer portal):
```bash
export STM_API_KEY="YOUR_STM_API_KEY"    # Windows PowerShell: $env:STM_API_KEY="YOUR_STM_API_KEY"
```

3) **Download the STM static GTFS** (ZIP) and run:
```bash
python stm_next.py --gtfs /path/to/gtfs_stm.zip --stop 52552
# or by stop_id:
python stm_next.py --gtfs /path/to/gtfs_stm.zip --stop 12345
# or by name (first match returned):
python stm_next.py --gtfs /path/to/gtfs_stm.zip --stop "Côte-Vertu / Décarie"
```

Optional flags:
- `--max N` : number of arrivals to display (default 3)
- `--json`  : output JSON instead of human-readable text

## How it works

- Polls STM **GTFS-Realtime v2** endpoints:
  - `GET /pub/od/gtfs-rt/ic/v2/tripUpdates` (protobuf)
  - `GET /pub/od/gtfs-rt/ic/v2/vehiclePositions` (protobuf)
  - Header: `apiKey: <your_key>`
- Joins RT with your static **GTFS** (stops, routes, trips) to label route/headsigns and compute vehicle distance to the stop.
- Handles GTFS after-midnight times (e.g., `25:10:00`) via epoch timestamps in TripUpdates.

## Quotas (from STM)

Per account/org: **10 requests/second** and **10,000 requests/day**. Centralize polling server-side for apps. This CLI performs just two requests per run (tripUpdates + vehiclePositions).

## Known limitations

- If STM doesn’t publish a prediction for your stop at that moment, you’ll see “No realtime arrivals found”. (You could add a scheduled-times fallback using `stop_times.txt` if you want.)
- Distances are great-circle (haversine) from the bus to the stop—road distance is longer.
- Output is English; you can localize easily in the print section.

## License & attribution

Data © Société de transport de Montréal (STM), provided under **CC BY 4.0**. This tool is provided “as-is” without warranty.
