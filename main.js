(async function init() {
  let landPolygons;

  async function loadGeoJSON(url) {
    const response = await fetch(url);
    return await response.json();
  }

  landPolygons = await loadGeoJSON('assets/land.geojson');
  const cities = await loadGeoJSON('assets/cities.geojson');

  function getRandomCityPoint(cities) {
    const city = cities.features[Math.floor(Math.random() * cities.features.length)];
    return {
      lat: city.geometry.coordinates[1],
      lng: city.geometry.coordinates[0]
    };
  }

  const start = getRandomCityPoint(cities);
  const GameState = { player: { lat: start.lat, lng: start.lng } };

  const map = L.map('map', {
    zoomControl: true,
    zoomSnap: 0.25,
    minZoom: 15,
    maxZoom: 17,
    preferCanvas: true,
    keepBuffer: 8
  });

  const baseLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);

  let currentIcon = 'assets/car.png';
  const playerMarker = L.marker([GameState.player.lat, GameState.player.lng], {
    icon: L.divIcon({
      html: `<img src="${currentIcon}" style="width:40px;height:40px;transform: rotate(0deg); transform-origin: center center;">`,
      iconSize: [40, 40],
      className: ''
    })
  }).addTo(map);

  map.setView(playerMarker.getLatLng(), 17, { animate: false });

  window.addEventListener('load', () => map.invalidateSize());
  window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 500));

  let carHeading = 0, carSpeed = 0, accelerating = false, lastFetchTime = 0;
  let touchTarget = null;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { carSpeed += 0.03; accelerating = true; }
    if (e.key === 'ArrowDown') { carSpeed -= 0.03; accelerating = true; }
    if (e.key === 'ArrowLeft') carHeading -= 8;
    if (e.key === 'ArrowRight') carHeading += 8;
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') accelerating = false;
  });

  if (window.innerWidth <= 768) {
    document.getElementById('desktopInstructions').style.display = 'none';
    setupTouchDirectionControl();
  }

  function setupTouchDirectionControl() {
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchTarget = e.touches[0];
        accelerating = true;
      }
    });

    document.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        touchTarget = e.touches[0];
      }
    });

    document.addEventListener('touchend', () => {
      touchTarget = null;
      accelerating = false;
    });
  }

  setInterval(() => {
    if (!accelerating) {
      carSpeed += (0 - carSpeed) * 0.1;
    }
  }, 50);

async function fetchWikidataContent(lat, lon) {
  console.log(`🔎 Attempting fetch for (${lat.toFixed(5)}, ${lon.toFixed(5)})`);

  try {
    const query = `
      SELECT ?item ?itemLabel ?description ?image WHERE {
        SERVICE wikibase:around {
          ?item wdt:P625 ?coord .
          bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral .
          bd:serviceParam wikibase:radius "10" .
        }
        OPTIONAL { ?item schema:description ?description FILTER(LANG(?description) = "en") }
        OPTIONAL { ?item wdt:P18 ?image }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
      LIMIT 1
    `;

    const response = await fetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: {
        "Content-Type": "application/sparql-query",
        "Accept": "application/sparql-results+json"
      },
      body: query
    });

    const data = await response.json();
    const result = data.results.bindings[0];
    if (!result) {
      console.log("⚠️ No result from Wikidata.");
      document.getElementById("infoPanel").style.display = "none";
      return;
    }

    const title = result.itemLabel.value;
    const description = result.description?.value || "No description available.";
    const wikidataUrl = result.item.value;

    let imgHtml = "";
    if (result.image) {
      const fileName = result.image.value.split("/").pop();
      const commonsResp = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&titles=File:${fileName}&prop=imageinfo&iiprop=url&format=json&origin=*`);
      const commonsData = await commonsResp.json();
      const page = Object.values(commonsData.query.pages)[0];
      const imgUrl = page.imageinfo?.[0]?.url;
      if (imgUrl) {
        imgHtml = `<img src="${imgUrl}" style="max-width:100%; margin-bottom:10px;" />`;
      }
    }

    console.log(`✅ Fetched: ${title}`);

    const infoPanel = document.getElementById("infoPanel");
    infoPanel.innerHTML = `
      <h3>${title}</h3>
      ${imgHtml}
      <p>${description}</p>
      <a href="${wikidataUrl}" target="_blank">View on Wikidata</a>
    `;
    infoPanel.style.display = "block";
  } catch (err) {
    console.error("🚨 Wikidata fetch error:", err);
    document.getElementById("infoPanel").style.display = "none";
  }
}

function updateCarPosition() {
  try {
    console.log("🌀 updateCarPosition running");

    const latlng = playerMarker.getLatLng();
    let newLat = latlng.lat;
    let newLng = latlng.lng;

    if (window.innerWidth <= 768 && touchTarget) {
      const mapCenter = map.latLngToContainerPoint(latlng);
      const touchPoint = L.point(touchTarget.clientX, touchTarget.clientY);
      const angle = Math.atan2(touchPoint.x - mapCenter.x, mapCenter.y - touchPoint.y);
      const targetHeading = angle * 180 / Math.PI;
      const delta = ((targetHeading - carHeading + 540) % 360) - 180;
      carHeading += delta * 0.05;
      const targetSpeed = 0.2;
      carSpeed += (targetSpeed - carSpeed) * 0.01;
    }

    const headingRad = carHeading * Math.PI / 180;

    if (Math.abs(carSpeed) > 0.001) {
      carSpeed = Math.max(Math.min(carSpeed, 4.0), -4.0);
      const distance = carSpeed * 0.001;
      newLat += distance * Math.cos(headingRad);
      newLng += distance * Math.sin(headingRad);
    }

    console.log(`🚗 Pos: ${newLat.toFixed(5)}, ${newLng.toFixed(5)} | Speed: ${carSpeed.toFixed(3)}`);

    newLat = Math.max(-85, Math.min(85, newLat));
    newLng = ((newLng + 180) % 360 + 360) % 360 - 180;

    const pt = turf.point([newLng, newLat]);
    const isLand = landPolygons.features.some(feature => turf.booleanPointInPolygon(pt, feature));
    const onWater = !isLand;
    const newIcon = onWater ? 'assets/boat.png' : 'assets/car.png';

    if (newIcon !== currentIcon) {
      currentIcon = newIcon;
      playerMarker.setIcon(L.divIcon({
        html: `<img src="${currentIcon}" style="width:40px;height:40px;transform: rotate(${carHeading}deg); transform-origin: center center;">`,
        iconSize: [40, 40],
        className: ''
      }));
    }

    playerMarker.setLatLng([newLat, newLng]);
    const iconElement = playerMarker.getElement();
    if (iconElement instanceof HTMLElement) {
      const img = iconElement.querySelector('img');
      if (img) {
        img.style.transformOrigin = 'center center';
        img.style.transform = `rotate(${carHeading}deg)`;
      }
    }

    map.panTo([newLat, newLng], { animate: false });

const oldLat = GameState.player.lat;
const oldLng = GameState.player.lng;
const moved = Math.hypot(newLat - oldLat, newLng - oldLng) > 0.0005;
const now = Date.now();

console.log(`📦 moved: ${moved}, deltaT: ${now - lastFetchTime}`);

if (carSpeed !== 0 && now - lastFetchTime > 1000 && moved) {
  lastFetchTime = now;
  fetchWikidataContent(newLat, newLng);
}

GameState.player.lat = newLat;
GameState.player.lng = newLng;


    requestAnimationFrame(updateCarPosition);
  } catch (e) {
    console.error("💥 updateCarPosition error:", e);
  }
}

  updateCarPosition();

  document.getElementById('myLocation').onclick = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(position => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        playerMarker.setLatLng([lat, lng]);
        map.setView([lat, lng], 17);
        GameState.player.lat = lat;
        GameState.player.lng = lng;
      });
    }
  };

  document.getElementById('randomLocation').onclick = () => {
    const random = getRandomCityPoint(cities);
    playerMarker.setLatLng([random.lat, random.lng]);
    map.setView([random.lat, random.lng], 17);
    GameState.player.lat = random.lat;
    GameState.player.lng = random.lng;
  };
})();
