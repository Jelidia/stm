// server/utils.js
export function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dphi = toRad(lat2 - lat1);
    const dlmb = toRad(lon2 - lon1);
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dlmb / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

// "25:15:00" -> seconds since midnight (supports >24h)
export function parseGtfsTime(hms) {
    if (!hms) return null;
    const [h, m, s] = hms.split(":").map(n => parseInt(n, 10) || 0);
    return h * 3600 + m * 60 + s;
}

export function secondsToClock(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

export function yyyymmdd(date) {
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    return `${y}${m}${d}`;
}

// Monday=1 ... Sunday=0 (GTFS uses monday..sunday flags)
export function gtfsDow(date) {
    const js = date.getDay();           // Sunday=0 ... Saturday=6
    return js === 0 ? 0 : js;           // 0..6 with Sunday=0 matches gtfs "sunday"
}
