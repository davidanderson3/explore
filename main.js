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
    if (!accelerating) carSpeed *= 0.99;
  }, 50);

  async function fetchWikipediaContent(lat, lon) {
    try {
      const response = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}%7C${lon}&gsradius=10000&gslimit=1&format=json&origin=*`);
      const data = await response.json();
      const pages = data.query.geosearch;

      if (pages.length > 0) {
        const page = pages[0];
        L.marker([page.lat, page.lon]).addTo(map).bindPopup(page.title);
        const title = page.title;
        const urlTitle = encodeURIComponent(title.replace(/ /g, '_'));
        const pageResponse = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${urlTitle}&format=json&origin=*`);
        const pageData = await pageResponse.json();
        const pageId = Object.keys(pageData.query.pages)[0];
        const extract = pageData.query.pages[pageId].extract;

        let isSpecial = false;
        try {
          const catResponse = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${urlTitle}&prop=categories&format=json&origin=*`);
          const catData = await catResponse.json();
          const categories = catData.query.pages[pageId].categories?.map(c => c.title.toLowerCase()) || [];
          const specialCategories = ['world heritage', 'historic landmark', 'national monument', 'unesco', 'natural wonder', 'architectural landmark'];
          isSpecial = categories.some(cat => specialCategories.some(sc => cat.includes(sc)));
        } catch {}

        if (isSpecial) {
          const specialMsg = document.createElement('div');
          specialMsg.textContent = '★ SPECIAL SITE! ★';
          specialMsg.style.position = 'absolute';
          specialMsg.style.top = '50%';
          specialMsg.style.left = '50%';
          specialMsg.style.transform = 'translate(-50%, -50%)';
          specialMsg.style.background = 'gold';
          specialMsg.style.padding = '20px';
          specialMsg.style.fontSize = '24px';
          specialMsg.style.fontWeight = 'bold';
          specialMsg.style.border = '3px solid black';
          specialMsg.style.borderRadius = '10px';
          specialMsg.style.zIndex = '2000';
          document.body.appendChild(specialMsg);

          specialMsg.animate([
            { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
            { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 0 }
          ], {
            duration: 2000,
            easing: 'ease-out'
          });

          setTimeout(() => document.body.removeChild(specialMsg), 2000);
        }

        const infoPanel = document.getElementById('infoPanel');
        let imgHtml = '';
        try {
          const imgResponse = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${urlTitle}&prop=pageimages&format=json&pithumbsize=300&origin=*`);
          const imgData = await imgResponse.json();
          const imgPageId = Object.keys(imgData.query.pages)[0];
          const img = imgData.query.pages[imgPageId].thumbnail ? imgData.query.pages[imgPageId].thumbnail.source : '';
          if (img) imgHtml = `<img src='${img}' style='max-width:100%; margin-bottom:10px;'>`;
        } catch {}

        infoPanel.innerHTML = `<h3>${title}</h3>${imgHtml}<p>${extract}</p><a href='https://en.wikipedia.org/wiki/${urlTitle}' target='_blank'>Read more on Wikipedia</a>`;
        infoPanel.style.display = 'block';
      } else {
        document.getElementById('infoPanel').style.display = 'none';
      }
    } catch (err) {
      console.error(err);
      document.getElementById('infoPanel').style.display = 'none';
    }
  }

  function updateCarPosition() {
    const latlng = playerMarker.getLatLng();

    if (touchTarget) {
      const mapSize = map.getSize();
      const mapCenter = map.latLngToContainerPoint(latlng);
      const touchPoint = L.point(touchTarget.clientX, touchTarget.clientY);
      const angle = Math.atan2(touchPoint.x - mapCenter.x, mapCenter.y - touchPoint.y);
      const targetHeading = angle * 180 / Math.PI;
      let delta = ((targetHeading - carHeading + 540) % 360) - 180;
      carHeading += delta * 0.05; // smoother turning
      const targetSpeed = 1.0;
      carSpeed += (targetSpeed - carSpeed) * 0.05; // smooth acceleration
      let delta = ((targetHeading - carHeading + 540) % 360) - 180;
      carHeading += delta * 0.1; // adjust 10% of the way toward target
      carSpeed += 0.01;
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

    const now = Date.now();
    if (carSpeed !== 0 && (now - lastFetchTime > 3000)) {
      fetchWikipediaContent(newLat, newLng);
      lastFetchTime = now;
    }

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