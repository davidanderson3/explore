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

  const terrainLayer = L.tileLayer('https://stamen-tiles.a.ssl.fastly.net/terrain/{z}/{x}/{y}.jpg', {
    attribution: 'Map tiles by Stamen Design, CC BY 3.0 — Map data © OpenStreetMap contributors',
    maxZoom: 18
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
    if (!accelerating) carSpeed *= 0.99;
  }, 50);

  function updateCarPosition() {
    const latlng = playerMarker.getLatLng();

    if (touchTarget) {
      const mapSize = map.getSize();
      const mapCenter = map.latLngToContainerPoint(latlng);
      const touchPoint = L.point(touchTarget.clientX, touchTarget.clientY);
      const angle = Math.atan2(touchPoint.x - mapCenter.x, mapCenter.y - touchPoint.y);
      carHeading = angle * 180 / Math.PI;
      carSpeed += 0.01; // accelerate while touching
    }

    const headingRad = carHeading * Math.PI / 180;
    let newLat = latlng.lat, newLng = latlng.lng;

    if (Math.abs(carSpeed) > 0.001) {
      carSpeed = Math.max(Math.min(carSpeed, 4.0), -4.0);
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
