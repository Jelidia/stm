# STM Bus — Favourites (Web)

A tiny **free** web app you can open on your phone to see the **next STM buses** at your favourite stops.
No App Store. No frameworks. Just **Node + Express** backend (keeps your key private) and a **static HTML/JS** frontend.

* ✅ Add your own **favourites** (stop code/ID + nickname) – stored in your browser (**localStorage**)
* ✅ Shows **ETA** and **route/headsign**
* ✅ If the bus reports GPS: shows **vehicle location** + quick **Google Maps** link
* ✅ Server caches GTFS-Realtime for **15s** to respect STM quotas
* 🔒 Your **STM API key** stays server-side in a **git-ignored `.env`**

> **Note**: STM realtime feeds include **bus only**. **Métro** is *not* tracked in GTFS-RT; you’ll see planned times only if you add support for static schedules (see Roadmap).

---

## Contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Install & Run](#install--run)
4. [Environment Variables](#environment-variables)
5. [Data Files (GTFS)](#data-files-gtfs)
6. [API Endpoints](#api-endpoints)
7. [Using the Web App](#using-the-web-app)
8. [Finding the Right Stop](#finding-the-right-stop)
9. [Realtime vs Not Realtime](#realtime-vs-not-realtime)
10. [Troubleshooting](#troubleshooting)
11. [Deploying for Free](#deploying-for-free)
12. [Security & Quotas](#security--quotas)
13. [Roadmap](#roadmap)
14. [License & Credits](#license--credits)

---

## Architecture

```
stm/
  .env                 # your secrets (not committed)
  .gitignore
  package.json
  public/              # static site
    index.html
    app.js
    style.css
  server/              # Node/Express backend
    server.js          # serves static + JSON API
    gtfs.js            # parses GTFS zip (stops, routes, trips)
    rt.js              # downloads + caches GTFS-RT feeds
    utils.js           # haversine, helpers
  data/
    gtfs_stm.zip       # (local) static GTFS archive (you add this)
```

* **Backend**: Express API shields your key and merges **GTFS-RT** with **GTFS static** to resolve names, distances, etc.
* **Frontend**: Vanilla HTML/JS. Favourites are persisted in the browser.

---

## Prerequisites

* **Node.js 18+** (Node 22 works)
* An **STM developer key** from the STM portal
* The latest **STM GTFS zip** (static schedules) — download from STM Open Data

Install deps:

```powershell
npm i
```

---

## Install & Run

### Windows (PowerShell)

```powershell
# 1) put your GTFS file locally
mkdir -Force .\data
Copy-Item "C:\Path\to\gtfs_stm.zip" ".\data\gtfs_stm.zip"

# 2) create .env (see variables below)
notepad .env

# 3) start
npm run dev
```

Open: [http://localhost:3000](http://localhost:3000)
From your phone (same Wi-Fi): `http://<your_PC_IP>:3000`

Find your PC IP with `ipconfig` → IPv4 Address.

### macOS / Linux

```bash
mkdir -p data && cp ~/Downloads/gtfs_stm.zip data/gtfs_stm.zip
cp .env.example .env   # if provided, otherwise create .env
npm run dev
```

---

## Environment Variables

Create a file **`.env`** in the project root:

```
STM_API_KEY=YOUR_REAL_KEY
GTFS_ZIP=./data/gtfs_stm.zip
PORT=3000
```

**Never commit your `.env`.** It’s already in `.gitignore`.

---

## Data Files (GTFS)

This app needs the **static GTFS** to map IDs to names and coordinates:

* `stops.txt` – stop_id, stop_code, stop_name, stop_lat/lon, location_type
* `routes.txt` – route_id, route_short_name, route_long_name, …
* `trips.txt` – trip_id, route_id, trip_headsign, …

Place the **zip** at `./data/gtfs_stm.zip` (or change `GTFS_ZIP`).

---

## API Endpoints

All JSON responses.

### `GET /api/resolve?q=<query>`

Resolve a stop by **stop_code**, **stop_id**, or **name substring**.

**Response**

```json
[
  {
    "stop_id": "10272",
    "stop_code": "10272",
    "stop_name": "Beaubien / 13e Avenue",
    "lat": 45.55649,
    "lon": -73.58513
  }
]
```

### `GET /api/stop/:id?max=3`

`id` can be **stop_code**, **stop_id**, or name.
Returns next arrivals from **GTFS-RT** (if any) plus vehicle info.

**Response**

```json
{
  "stop": {
    "stop_id": "10272",
    "stop_code": "10272",
    "stop_name": "Beaubien / 13e Avenue",
    "lat": 45.55649,
    "lon": -73.58513
  },
  "last_updated": "2025-10-03T19:12:00.000Z",
  "arrivals": [
    {
      "eta_seconds": 210,
      "arrival_epoch_utc": 1738585920,
      "route": "18",
      "headsign": "Honoré-Beaugrand",
      "trip_id": "12345678",
      "stop_id": "10272",
      "vehicle": {
        "id": "BUS-1234",
        "lat": 45.5582,
        "lon": -73.5829,
        "bearing": 92,
        "distance_m_to_stop": 310,
        "occupancy_status": null
      }
    }
  ]
}
```

**Notes**

* If there’s **no realtime** for that stop at this moment, `arrivals` is an **empty array** (the UI shows *“No realtime arrivals found right now.”*). See [Roadmap](#roadmap) for static fallback.

---

## Using the Web App

1. Open the page.
2. In **Add favourite**, enter a **stop code** (numeric) or **stop id** (string) and a nickname.
3. Tap **View** to fetch arrivals.

   * If a bus is reporting GPS, you’ll see its coordinates & a link **Open map**.
   * If nothing is listed, either no bus is imminent or no GPS is available for that stop right now.

> Tip: numeric **stop_code** (on the physical bus sign) is easiest (e.g., `10272`).

---

## Finding the Right Stop

Many street corners have **two stops with the same name** (one per direction). Example:

* `stop_code = 51982` — *Beaubien / 13e Avenue* (location_type=0)
* `stop_code = 51983` — *Beaubien / 13e Avenue* (location_type=0)

Ways to pick the right one:

* Check the **headsign** of upcoming trips (Est vs Ouest).
* Open each stop’s **lat/lon** on a map to see **which side of the street** it is.
* In `stop_times.txt`, see which stop_code appears in trips of each **direction**.

---

## Realtime vs Not Realtime

* **Buses**: appear in GTFS-RT (**tripUpdates**/**vehiclePositions**) *only while in service and when a vehicle is sending GPS*.
  If none are near/active, you’ll see no realtime arrivals.

* **Métro**: not available in GTFS-RT. You’ll never get live positions for métro stations. (Static schedule fallback can be added; see Roadmap.)

**GTFS hint**
`stops.location_type`:

* `0` = physical bus stop (**realtime-capable** when a bus is active)
* `1` or `2` = station/parent (e.g., métro) — **not realtime**

---

## Troubleshooting

* **“Missing STM_API_KEY in .env”**
  Create `.env` with `STM_API_KEY` and restart `npm run dev`.

* **“GTFS_ZIP not found”**
  Put your zip at the path in `GTFS_ZIP` or update the variable.

* **HTTP 400 from RT**
  Wrong/disabled key or wrong header. The server uses `accept: application/x-protobuf` and `apiKey: <key>`.

* **HTTP 429 or “Rate limit exceeded”**
  You’re hitting per-second/day limits. The backend caches for **15s**; don’t hammer refresh.

* **500 from `/api/stop/:id`**
  Often a transient decode/network issue. Check your key with:

  ```powershell
  $k="YOUR_KEY"; iwr "https://api.stm.info/pub/od/gtfs-rt/ic/v2/tripUpdates" -Headers @{accept="application/x-protobuf"; apiKey=$k} -Method GET -UseBasicParsing
  ```

* **Git won’t commit due to `.vs` locks**
  Add to `.gitignore` and avoid staging `.vs/`.

---

## Deploying for Free

* **Render / Railway / Fly.io / (Vercel serverless is ok too)**
  Set **environment variables** (`STM_API_KEY`, `GTFS_ZIP`, `PORT`).
  You can store `gtfs_stm.zip` in the repo (or attach a persistent disk, or fetch at boot).

---

## Security & Quotas

* Your **API key** never reaches the browser. Only the server calls STM.
* Don’t publish your `.env`.
* STM limits: typically **10 req/s** and **10k/day** per developer account, plus **global API limits**. Our 15s cache helps.

---

## Roadmap

* **Static fallback times** (from `stop_times.txt`) when no realtime is available – UI would then say *“No GPS; showing planned times”*.
* Optional **Leaflet** mini-map inline.
* “Pick direction” helper when multiple stops share the same name (label as **Est/Ouest**).

---

## License & Credits

* **Code**: MIT (yours to do what you want).
* **Data**: © **STM**, Open Data. Respect STM terms. Do not rely on this for safety-critical use.
* GTFS-Realtime schema via **gtfs-realtime-bindings**.

---

## Handy Git one-liners (PowerShell)

Commit tracked changes + package-lock, skip `.vs`:

```powershell
git add -u ; git add package-lock.json ; git commit -m "update app" ; git push origin main --force-with-lease
```

Force overwrite (dangerous):

```powershell
git add -A ; git commit -m "force" ; git push origin main --force
```

---
