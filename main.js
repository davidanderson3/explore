(async function init() {
  const keysPressed = {};
  const projectiles = [];

  const canvas = document.getElementById("mapSampler");
  const ctx = canvas.getContext("2d");

  async function loadGeoJSON(url) {
    const response = await fetch(url);
    return await response.json();
  }

  const landPolygons = await loadGeoJSON('assets/land.geojson');
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
    minZoom: 12,
    maxZoom: 14,
    preferCanvas: true,
    keepBuffer: 16
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    subdomains: ['a', 'b', 'c'],
    maxZoom: 17,
    crossOrigin: true
  }).addTo(map);

  let currentIcon = 'assets/car.png';
  const playerMarker = L.marker([GameState.player.lat, GameState.player.lng], {
    icon: L.divIcon({
      html: `<img src="${currentIcon}" style="width:40px;height:40px;transform: rotate(0deg); transform-origin: center center;">`,
      iconSize: [40, 40],
      className: ''
    })
  }).addTo(map);

  map.setView(playerMarker.getLatLng(), 15, { animate: false });

  window.addEventListener('load', () => map.invalidateSize());
  window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 500));

  let carHeading = 0, carSpeed = 0, accelerating = false, lastFetchTime = 0;
  let touchTarget = null;

document.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
    e.preventDefault(); // ✅ stop arrow keys and spacebar from scrolling the page
  }

  keysPressed[e.key] = true;

  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') accelerating = true;
  if (e.code === 'Space') fireProjectile();
});

document.addEventListener('keyup', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
    e.preventDefault();
  }

  keysPressed[e.key] = false;

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

  function fireProjectile() {
    const { lat, lng } = playerMarker.getLatLng();
    const headingRad = carHeading * Math.PI / 180;
    const speed = 0.01;

    const projectile = {
      lat,
      lng,
      dx: speed * Math.cos(headingRad),
      dy: speed * Math.sin(headingRad),
      marker: L.circleMarker([lat, lng], {
        radius: 4,
        color: 'red',
        fillColor: 'red',
        fillOpacity: 0.9,
        weight: 1
      }).addTo(map),
      lifetime: 100
    };

    projectiles.push(projectile);
  }

  setInterval(() => {
    if (!accelerating) carSpeed += (0 - carSpeed) * 0.1;
  }, 50);

  async function isBlueUnderCar(lat, lng) {
    const zoom = map.getZoom();
    const tileSize = 256;

    const tileX = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
    const tileY = Math.floor(
      (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)
    );

    const tileUrl = `https://a.tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`;

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        ctx.clearRect(0, 0, tileSize, tileSize);
        ctx.drawImage(img, 0, 0, tileSize, tileSize);

        const n = Math.pow(2, zoom);
        const xtileOffset = ((lng + 180) / 360 * n - tileX) * tileSize;
        const ytileOffset = (
          (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n - tileY
        ) * tileSize;

        const pixel = ctx.getImageData(xtileOffset, ytileOffset, 1, 1).data;
        const [r, g, b] = pixel;
        const isBlue = b > 150 && r < 120 && g < 130;
        resolve(isBlue);
      };
      img.onerror = () => resolve(false);
      img.src = tileUrl;
    });
  }

  async function fetchWikipediaContent(lat, lon) {
    console.log(`🔎 Fetching from Wikipedia near (${lat.toFixed(5)}, ${lon.toFixed(5)})`);
    try {
      const geoUrl = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lon}&gsradius=3000&gslimit=1&format=json&origin=*`;
      const geoResp = await fetch(geoUrl);
      const geoData = await geoResp.json();
      const pages = geoData.query.geosearch;

      if (!pages.length) {
        console.log("⚠️ No nearby Wikipedia results.");
        document.getElementById("infoPanel").style.display = "none";
        return;
      }

      const page = pages[0];
      const title = page.title;
      const urlTitle = encodeURIComponent(title.replace(/ /g, "_"));

      L.marker([page.lat, page.lon], {
        title: title
      }).addTo(map).bindPopup(
        `<strong>${title}</strong><br><a href="https://en.wikipedia.org/wiki/${urlTitle}" target="_blank">Open on Wikipedia</a>`
      );

      const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${urlTitle}&format=json&origin=*`;
      const extractResp = await fetch(extractUrl);
      const extractData = await extractResp.json();
      const pageId = Object.keys(extractData.query.pages)[0];
      const extract = extractData.query.pages[pageId].extract;

      let imgHtml = "";
      try {
        const imgResp = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${urlTitle}&prop=pageimages&format=json&pithumbsize=300&origin=*`);
        const imgData = await imgResp.json();
        const imgPageId = Object.keys(imgData.query.pages)[0];
        const img = imgData.query.pages[imgPageId].thumbnail?.source;
        if (img) imgHtml = `<img src="${img}" style="max-width:100%; margin-bottom:10px;">`;
      } catch {}

      const infoPanel = document.getElementById("infoPanel");
      infoPanel.innerHTML = `
        <h3>${title}</h3>
        ${imgHtml}
        <p>${extract}</p>
        <a href="https://en.wikipedia.org/wiki/${urlTitle}" target="_blank">Read more on Wikipedia</a>
      `;
      infoPanel.style.display = "block";

    } catch (err) {
      console.error("🚨 Wikipedia fetch error:", err);
      document.getElementById("infoPanel").style.display = "none";
    }
  }

  async function updateCarPosition() {
    try {
      const latlng = playerMarker.getLatLng();
      let newLat = latlng.lat;
      let newLng = latlng.lng;

      if (keysPressed['ArrowLeft']) carHeading -= 1;
      if (keysPressed['ArrowRight']) carHeading += 1;
      if (keysPressed['ArrowUp']) carSpeed += 0.001;
      if (keysPressed['ArrowDown']) carSpeed -= 0.001;

      if (window.innerWidth <= 768 && touchTarget) {
        const mapCenter = map.latLngToContainerPoint(latlng);
        const touchPoint = L.point(touchTarget.clientX, touchTarget.clientY);
        const angle = Math.atan2(touchPoint.x - mapCenter.x, mapCenter.y - touchPoint.y);
        const targetHeading = angle * 180 / Math.PI;
        const delta = ((targetHeading - carHeading + 540) % 360) - 180;
        carHeading += delta * 0.01;
        const targetSpeed = 0.05;
        carSpeed += (targetSpeed - carSpeed) * 0.001;
      }

      const headingRad = carHeading * Math.PI / 180;

      if (Math.abs(carSpeed) > 0.001) {
        carSpeed = Math.max(Math.min(carSpeed, 2.5), -2.5);
        const distance = carSpeed * 0.001;
        newLat += distance * Math.cos(headingRad);
        newLng += distance * Math.sin(headingRad);
      }

      newLat = Math.max(-85, Math.min(85, newLat));
      newLng = ((newLng + 180) % 360 + 360) % 360 - 180;

if (currentIcon !== 'assets/car.png') {
  currentIcon = 'assets/car.png';
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

      const center = map.getCenter();
      if (Math.abs(center.lat - newLat) > 0.0025 || Math.abs(center.lng - newLng) > 0.0025) {
        map.panTo([newLat, newLng], { animate: true });
      }

      const now = Date.now();
      if (now - lastFetchTime > 3000) {
        lastFetchTime = now;
        fetchWikipediaContent(newLat, newLng);
      }

      GameState.player.lat = newLat;
      GameState.player.lng = newLng;

      for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        p.lat += p.dy;
        p.lng += p.dx;
        p.marker.setLatLng([p.lat, p.lng]);
        if (--p.lifetime <= 0) {
          map.removeLayer(p.marker);
          projectiles.splice(i, 1);
        }
      }

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
        map.setView([lat, lng], 18);
        GameState.player.lat = lat;
        GameState.player.lng = lng;
      });
    }
  };

  document.getElementById('randomLocation').onclick = () => {
    const random = getRandomCityPoint(cities);
    playerMarker.setLatLng([random.lat, random.lng]);
    map.setView([random.lat, random.lng], 14);
    GameState.player.lat = random.lat;
    GameState.player.lng = random.lng;
  };
})();
