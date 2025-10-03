// public/app.js
const favKey = "stm_favourites_v1";
const favList = document.getElementById("favList");
const addForm = document.getElementById("addForm");
const stopInput = document.getElementById("stopInput");
const nameInput = document.getElementById("nameInput");
const outSec = document.getElementById("output");
const title = document.getElementById("title");
const results = document.getElementById("results");

function loadFavs() { try { return JSON.parse(localStorage.getItem(favKey) || "[]"); } catch { return []; } }
function saveFavs(list) { localStorage.setItem(favKey, JSON.stringify(list)); renderFavs(); }

function renderFavs() {
    const favs = loadFavs();
    favList.innerHTML = "";
    for (const f of favs) {
        const li = document.createElement("li");
        li.innerHTML = `
      <div>
        <div><b>${f.name}</b></div>
        <small>${f.query}</small>
      </div>
      <div>
        <button class="primary" data-act="view">View</button>
        <button data-act="del">Remove</button>
      </div>`;
        li.querySelector('[data-act="view"]').onclick = () => viewFav(f);
        li.querySelector('[data-act="del"]').onclick = () => saveFavs(favs.filter(x => x.id !== f.id));
        favList.appendChild(li);
    }
}

addForm.onsubmit = async (e) => {
    e.preventDefault();
    const query = stopInput.value.trim();
    const name = nameInput.value.trim() || query;
    if (!query) return;

    const m = await fetch(`/api/resolve?q=${encodeURIComponent(query)}`).then(r => r.json());
    if (!m.length) { alert("Stop not found. Try a numeric stop code printed on the bus pole (e.g., 50410)."); return; }

    const favs = loadFavs();
    favs.push({ id: Date.now(), query, name });
    saveFavs(favs);
    addForm.reset();
};

async function viewFav(f) {
    title.textContent = `${f.name}  —  ${f.query}`;
    results.innerHTML = "Loading…";
    outSec.hidden = false;

    const data = await fetch(`/api/stop/${encodeURIComponent(f.query)}?max=6`).then(r => r.json());
    if (data.error) { results.innerHTML = `<div class="card">Error: ${data.error}</div>`; return; }

    const items = data.arrivals || [];
    results.innerHTML = "";

    const badge = data.source === "realtime" ? `<span class="badge rt">realtime</span>`
        : data.source === "schedule" ? `<span class="badge sc">schedule</span>`
            : `<span class="badge none">no data</span>`;

    const note = data.note ? `<div class="note">${data.note}</div>` : "";

    if (!items.length) {
        results.innerHTML = `<div class="card">${badge} No realtime arrivals found right now.</div>${note}`;
        return;
    }

    results.innerHTML = `<div class="card">${badge} Upcoming buses:</div>${note}`;
    for (const a of items) {
        const when = new Date(a.arrival_epoch_utc * 1000);
        const mins = Math.max(0, Math.floor(a.eta_seconds / 60));
        const secs = Math.max(0, a.eta_seconds % 60);
        const v = a.vehicle;
        const gmaps = v ? `https://maps.google.com/?q=${v.lat},${v.lon}` : null;

        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = `
      <h3>Route ${a.route} → ${a.headsign || ""}</h3>
      <div><b>ETA:</b> ${mins} min ${secs.toString().padStart(2, "0")}s  <small>(${when.toLocaleTimeString()})</small></div>
      ${v ? `<div><b>Vehicle:</b> ${v.lat.toFixed(6)}, ${v.lon.toFixed(6)} (${v.distance_m_to_stop} m away${v.bearing != null ? `, ${Math.round(v.bearing)}°` : ''}) — <a href="${gmaps}" target="_blank">Open map</a></div>`
                : `<div><b>Vehicle:</b> not trackable (no GPS)</div>`}
    `;
        results.appendChild(div);
    }
}

renderFavs();
