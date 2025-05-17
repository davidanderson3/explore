// main.js
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

  const baseTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 8,
    crossOrigin: true,
    noWrap: true,
    detectRetina: true
  });

  const baseLayers = {
    "Streets": baseTileLayer,
    "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© ESRI',
      crossOrigin: true
    })
  };

  baseTileLayer.addTo(map);
  L.control.layers(baseLayers, null, { position: 'bottomleft' }).addTo(map);

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
    setupSwipeControls();
  }

  function setupSwipeControls() {
    let touchStartX = 0, touchStartY = 0;

    document.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    });

    document.addEventListener('touchend', (e) => {
      if (e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (absDx < 30 && absDy < 30) return;

        if (absDx > absDy) {
          if (dx > 0) carHeading += 8;
          else carHeading -= 8;
        } else {
          if (dy > 0) carSpeed -= 0.05;
          else carSpeed += 0.05;
          accelerating = true;
        }
      }
    });
  }

  setInterval(() => {
    if (!accelerating) carSpeed *= 0.99;
    accelerating = false;
  }, 50);

  function updateCarPosition() {
    const latlng = playerMarker.getLatLng();
    const headingRad = carHeading * Math.PI / 180;
    let newLat = latlng.lat, newLng = latlng.lng;

    if (Math.abs(carSpeed) > 0.001) {
      if (carSpeed > 4.0) carSpeed = 4.0;
      if (carSpeed < -4.0) carSpeed = -4.0;
      const distance = carSpeed * 0.001;
      newLat += distance * Math.cos(headingRad);
      newLng += distance * Math.sin(headingRad);
    }

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
    GameState.player.lat = newLat;
    GameState.player.lng = newLng;

    requestAnimationFrame(updateCarPosition);
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
