import fetch from "node-fetch";
import Gtfs from "gtfs-realtime-bindings";

const BASE = "https://api.stm.info/pub/od/gtfs-rt/ic/v2";
const TTL_MS = 15000;

const cache = {
  vehiclePositions: null, vehicleTs: 0,
  tripUpdates: null, tripTs: 0
};

async function fetchRt(path, apiKey) {
  const res = await fetch(`${BASE}/${path}`, {
    headers: { accept: "application/x-protobuf", apiKey },
    timeout: 10000
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return Gtfs.FeedMessage.decode(buf);
}

export async function getTripUpdates(apiKey) {
  const now = Date.now();
  if (cache.tripUpdates && now - cache.tripTs < TTL_MS) return cache.tripUpdates;
  cache.tripUpdates = await fetchRt("tripUpdates", apiKey);
  cache.tripTs = now;
  return cache.tripUpdates;
}

export async function getVehiclePositions(apiKey) {
  const now = Date.now();
  if (cache.vehiclePositions && now - cache.vehicleTs < TTL_MS) return cache.vehiclePositions;
  cache.vehiclePositions = await fetchRt("vehiclePositions", apiKey);
  cache.vehicleTs = now;
  return cache.vehiclePositions;
}
