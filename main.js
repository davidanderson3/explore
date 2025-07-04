(async function init() {
  const keysPressed = {};
  const projectiles = [];
  const enemyProjectiles = [];
  let currentLevel = 1;
  let playerMarker;


  async function loadGeoJSON(url) {
    const response = await fetch(url);
    return await response.json();
  }

  function showInfoPanel() {
    const panel = document.getElementById("infoPanel");
    if (window.innerWidth <= 768) {
      panel.classList.add("open");
      panel.style.display = "block";
    } else {
      panel.style.display = "block";
    }
  }

  function hideInfoPanel() {
    const panel = document.getElementById("infoPanel");
    if (window.innerWidth <= 768) {
      panel.classList.remove("open");
      setTimeout(() => {
        panel.style.display = "none";
      }, 300);
    } else {
      panel.style.display = "none";
    }
  }


  const cities = await loadGeoJSON('assets/cities.geojson');

  const cityFeatures = cities.features;
  const startCityIdx = Math.floor(Math.random() * cityFeatures.length);
  const startCity = cityFeatures[startCityIdx];

  // Find a nearby city (closest, but not the same)
  let minDist = Infinity;
  let destCity = null;
  for (let i = 0; i < cityFeatures.length; i++) {
    if (i === startCityIdx) continue;
    const c = cityFeatures[i];
    const dLat = c.geometry.coordinates[1] - startCity.geometry.coordinates[1];
    const dLng = c.geometry.coordinates[0] - startCity.geometry.coordinates[0];
    const dist = Math.hypot(dLat, dLng);
    if (dist < minDist) {
      minDist = dist;
      destCity = c;
    }
  // Use startCity for your spawn point:
  const start = {
    lat: startCity.geometry.coordinates[1],
    lng: startCity.geometry.coordinates[0]
  };
  const GameState = { player: { lat: start.lat, lng: start.lng } };

  const map = L.map('map', {
    zoomControl: false,
    zoomSnap: 0.25,
    minZoom: 12,
    maxZoom: 14,
    preferCanvas: true,
    keepBuffer: 64
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    subdomains: ['a', 'b', 'c'],
    maxZoom: 17,
    crossOrigin: true
  }).addTo(map);


  window.addEventListener('load', () => map.invalidateSize());
  let currentIcon = "assets/car.png";
  window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 500));
  function startLevel1() {
    map.setView([20, 0], 2);
    document.getElementById("missionMessage").textContent = "Level 1: Click on France";
    function checkCountry(e) {
      const {lat, lng} = e.latlng;
      if (lat >= 41 && lat <= 51 && lng >= -5 && lng <= 9) {
        map.off("click", checkCountry);
        startLevel2();
      } else {
        alert("Not France. Try again!");
      }
    }
    map.on("click", checkCountry);
  }

  function startLevel2() {
    currentLevel = 2;
    playerMarker = L.marker([GameState.player.lat, GameState.player.lng], {
      icon: L.divIcon({
        html: `<img src="${currentIcon}" style="width:40px;height:40px;transform: rotate(0deg); transform-origin: center center;">`,
        iconSize: [40, 40],
        className: ""
      })
    }).addTo(map);
    map.setView(playerMarker.getLatLng(), 15, { animate: false });
    document.getElementById("missionMessage").textContent =
      `Mission starts in ${startCity.properties.NAME}. Your job is to get to ${destCity.properties.NAME}. Good luck!`;
    updatePlayerHealthBar();
    updateCarPosition();
  }

  function startLevel3() {
    currentLevel = 3;
    document.getElementById("missionMessage").textContent = "Level 3: You made it!";
  }


  let carHeading = 0, carSpeed = 0, accelerating = false, lastFetchTime = 0;
  let touchTarget = null;

  document.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }

    keysPressed[e.key] = true;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') accelerating = true;
    if (e.code === 'Space') fireProjectileSpray(); // <--- use spray
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

  function fireProjectileSpray() {
    const { lat, lng } = playerMarker.getLatLng();
    const baseHeading = carHeading;
    const sprayCount = 5; // Number of projectiles in the spray
    const spraySpread = 30; // Total degrees of spread
    const speed = 0.004; // Slower, more graceful

    for (let i = 0; i < sprayCount; i++) {
      const angle = baseHeading - spraySpread / 2 + (spraySpread / (sprayCount - 1)) * i;
      const headingRad = angle * Math.PI / 180;

      const projectile = {
        lat,
        lng,
        dx: speed * Math.sin(headingRad), // longitude (X)
        dy: speed * Math.cos(headingRad), // latitude (Y)
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
  }

  setInterval(() => {
    if (!accelerating) carSpeed += (0 - carSpeed) * 0.03; // Less friction, car coasts longer
  }, 50);

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
      } catch { }

      document.getElementById("infoContent").innerHTML = `
  <div style="margin-top: 24px;">
    <h3>${title}</h3>
  </div>
  ${imgHtml}
  <p>${extract}</p>
  <a href="https://en.wikipedia.org/wiki/${urlTitle}" target="_blank">Read more on Wikipedia</a>
`;

      showInfoPanel();


    } catch (err) {
      console.error("🚨 Wikipedia fetch error:", err);
      document.getElementById("infoPanel").style.display = "none";
    }
  }

  let enemy = null;
  let enemyMarker = null;
  let enemyHealthBar = null;
  let enemyMoveAngle = 0;
  let enemyMoveRadius = 0.008;
  let enemyMoveSpeed = 0.015;
  let enemyVelLat = 0;
  let enemyVelLng = 0;

  // Spawn the UFO near the player
  function spawnEnemy() {
    const playerPos = playerMarker.getLatLng();
    const centerLat = playerPos.lat + (Math.random() - 0.5) * 0.03;
    const centerLng = playerPos.lng + (Math.random() - 0.5) * 0.03;

    enemy = {
      centerLat,
      centerLng,
      lat: centerLat,
      lng: centerLng,
      health: 10,
      maxHealth: 10
    };
    enemyMoveAngle = Math.random() * Math.PI * 2;

    if (enemyMarker) map.removeLayer(enemyMarker);
    if (enemyHealthBar) map.removeLayer(enemyHealthBar);

    enemyMarker = L.marker([enemy.lat, enemy.lng], {
      icon: L.divIcon({
        html: `<img src="assets/ufo.png" style="width:80px;height:80px;">`,
        iconSize: [80, 80],
        className: ''
      })
    }).addTo(map);

    enemyHealthBar = L.rectangle([
      [enemy.lat + 0.004, enemy.lng - 0.002],      // Move further north (+0.004)
      [enemy.lat + 0.0044, enemy.lng + 0.002]      // Move further north (+0.0044)
    ], {
      color: "#800000",        // Dark red border
      weight: 2,
      fillColor: "#800000",    // Dark red fill
      fillOpacity: 0.85
    }).addTo(map);
  }

  // UFO movement logic
  function moveEnemyUFO() {
    if (!enemy) return;

    // Make UFO less erratic and slower
    enemyVelLat += (Math.random() - 0.5) * 0.00004; // was 0.00008
    enemyVelLng += (Math.random() - 0.5) * 0.00004; // was 0.00008

    // Lower max velocity for slower UFO
    const maxVel = 0.0004; // was 0.0007
    enemyVelLat = Math.max(-maxVel, Math.min(maxVel, enemyVelLat));
    enemyVelLng = Math.max(-maxVel, Math.min(maxVel, enemyVelLng));

    // Move the UFO
    enemy.lat += enemyVelLat;
    enemy.lng += enemyVelLng;

    // Optionally, keep the UFO within a certain distance of its center
    const dLat = enemy.lat - enemy.centerLat;
    const dLng = enemy.lng - enemy.centerLng;
    const maxDist = 0.018;
    if (Math.hypot(dLat, dLng) > maxDist) {
      // Steer back toward center
      enemyVelLat -= dLat * 0.01;
      enemyVelLng -= dLng * 0.01;
    }

    if (enemyMarker) enemyMarker.setLatLng([enemy.lat, enemy.lng]);
    if (enemyHealthBar) {
      const healthRatio = enemy.health / enemy.maxHealth;
      const barLng1 = enemy.lng - 0.002;
      const barLng2 = enemy.lng - 0.002 + 0.004 * healthRatio;
      enemyHealthBar.setBounds([
        [enemy.lat + 0.004, barLng1],
        [enemy.lat + 0.0044, barLng2]
      ]);
      enemyHealthBar.bringToFront();
    }
  }

  // Collision detection and respawn logic
  function handleEnemyHitAndRespawn() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      if (
        enemy &&
        Math.hypot(p.lat - enemy.lat, p.lng - enemy.lng) < 0.004
      ) {
        enemy.health--;
        if (enemy.health <= 0) {
          if (enemyMarker) map.removeLayer(enemyMarker);
          if (enemyHealthBar) map.removeLayer(enemyHealthBar);
          enemy = null;
          setTimeout(spawnEnemy, 2000);
        }
        map.removeLayer(p.marker);
        projectiles.splice(i, 1);
      }
    }
  }

  setInterval(() => {
    if (!accelerating) carSpeed += (0 - carSpeed) * 0.03; // Less friction, car coasts longer
  }, 50);

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
      } catch { }

      const infoPanel = document.getElementById("infoPanel");
      infoPanel.innerHTML = `
        <div style="margin-top: 24px;">
          <h3>${title}</h3>
        </div>
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
      if (keysPressed['ArrowUp']) carSpeed += 0.003;
      if (keysPressed['ArrowDown']) carSpeed -= 0.003;

      if (window.innerWidth <= 768 && touchTarget) {
        const mapCenter = map.latLngToContainerPoint(latlng);
        const touchPoint = L.point(touchTarget.clientX, touchTarget.clientY);
        const angle = Math.atan2(touchPoint.x - mapCenter.x, mapCenter.y - touchPoint.y);
        const targetHeading = angle * 180 / Math.PI;
        const delta = ((targetHeading - carHeading + 540) % 360) - 180;
        carHeading += delta * 0.01;
        const targetSpeed = 0.06;
        carSpeed += (targetSpeed - carSpeed) * 0.001;
      }

      const headingRad = carHeading * Math.PI / 180;

      if (Math.abs(carSpeed) > 0.001) {
        carSpeed = Math.max(Math.min(carSpeed, 5), -5);
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

      for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
        const p = enemyProjectiles[i];
        p.lat += p.dy;
        p.lng += p.dx;
        p.marker.setLatLng([p.lat, p.lng]);
        // --- Player collision check ---
        const playerPos = playerMarker.getLatLng();
        if (Math.hypot(p.lat - playerPos.lat, p.lng - playerPos.lng) < 0.002) {
          playerHealth -= 3; // Big health hit!
          updatePlayerHealthBar();
          map.removeLayer(p.marker);
          enemyProjectiles.splice(i, 1);
          if (playerHealth <= 0) {
            alert("Game Over! You were hit too many times.");
            playerHealth = playerMaxHealth;
            updatePlayerHealthBar();
          }
          continue;
        }
        if (--p.lifetime <= 0) {
          map.removeLayer(p.marker);
          enemyProjectiles.splice(i, 1);
        }
      }

      // Enemy randomly shoots (about once every 60 frames)
      if (enemy && Math.random() < 0.016) {
        enemyShootProjectile();
      }
// 
//       moveEnemyUFO();
//       handleEnemyHitAndRespawn();

//       if (enemy) {
//         const playerPos = playerMarker.getLatLng();
//         const distToUFO = Math.hypot(playerPos.lat - enemy.lat, playerPos.lng - enemy.lng);
//         if (distToUFO < 0.0025) { // Much closer, nearly touching
//           playerHealth -= 1;
//           updatePlayerHealthBar();
//           // Optional: bounce the car back a bit
//           const angleAway = Math.atan2(playerPos.lat - enemy.lat, playerPos.lng - enemy.lng);
//           const bounceDist = 0.003;
//           playerMarker.setLatLng([
//             playerPos.lat + Math.sin(angleAway) * bounceDist,
//             playerPos.lng + Math.cos(angleAway) * bounceDist
//           ]);
//           map.setView(playerMarker.getLatLng());
//           if (playerHealth <= 0) {
//             alert("Game Over! You crashed into the UFO!");
//             playerHealth = playerMaxHealth;
//             updatePlayerHealthBar();
//           }
//         }
      const distToDest = Math.hypot(newLat - destCity.geometry.coordinates[1], newLng - destCity.geometry.coordinates[0]);
      if (currentLevel === 2 && distToDest < 0.01) {
        startLevel3();
      }
//       }

      requestAnimationFrame(updateCarPosition);
    } catch (e) {
      console.error("💥 updateCarPosition error:", e);
    }

      // Call this every frame, e.g. at the end of updateCarPosition:
updateBeacon(
  playerMarker.getLatLng().lat,
  playerMarker.getLatLng().lng,
  destCity.geometry.coordinates[1],
  destCity.geometry.coordinates[0]
);
  }

  // --- INITIAL ENEMY SPAWN ---
//   spawnEnemy();

  // Start the game loop
//   updateCarPosition();


  // --- INITIAL ENEMY SPAWN ---
//   spawnEnemy();

  // Enemy randomly shoots (about once every 60 frames)
//   if (enemy && Math.random() < 0.016) {
//     enemyShootProjectile();
//   }

  function enemyShootProjectile() {
    if (!enemy) return;
    const angle = Math.random() * 360; // Random direction
    const headingRad = angle * Math.PI / 180;
    const speed = 0.0003; // Very slow

    const projectile = {
      lat: enemy.lat,
      lng: enemy.lng,
      dx: speed * Math.sin(headingRad),
      dy: speed * Math.cos(headingRad),
      marker: L.circleMarker([enemy.lat, enemy.lng], {
        radius: 7,
        color: 'purple',
        fillColor: 'purple',
        fillOpacity: 0.8,
        weight: 2
      }).addTo(map),
      lifetime: 300 // longer lifetime for visibility
    };

    enemyProjectiles.push(projectile);
  }

  let playerHealth = 5;
  const playerMaxHealth = 5;

  function updatePlayerHealthBar() {
    const fill = document.getElementById('playerHealthFill');
    if (fill) {
      const percent = Math.max(0, playerHealth) / playerMaxHealth * 100;
      fill.style.width = percent + "%";
      fill.style.background = percent > 50
        ? "linear-gradient(90deg, #43e97b, #38f9d7)"
        : "linear-gradient(90deg, #e53935, #ffb300)";
    }
  }

  let beaconAngle = 0;
let beaconTimer = 0;

function updateBeacon(playerLat, playerLng, destLat, destLng) {
  const now = Date.now();
  if (now - beaconTimer < 4000) return;

  beaconTimer = now;

  const angleRad = Math.atan2(destLng - playerLng, destLat - playerLat);
  const angleDeg = angleRad * 180 / Math.PI;

  let direction = '';
  if (angleDeg > -22.5 && angleDeg <= 22.5) direction = 'North';
  else if (angleDeg > 22.5 && angleDeg <= 67.5) direction = 'Northeast';
  else if (angleDeg > 67.5 && angleDeg <= 112.5) direction = 'East';
  else if (angleDeg > 112.5 && angleDeg <= 157.5) direction = 'Southeast';
  else if (angleDeg > 157.5 || angleDeg <= -157.5) direction = 'South';
  else if (angleDeg > -157.5 && angleDeg <= -112.5) direction = 'Southwest';
  else if (angleDeg > -112.5 && angleDeg <= -67.5) direction = 'West';
  else if (angleDeg > -67.5 && angleDeg <= -22.5) direction = 'Northwest';

const glow = document.getElementById('beaconGlow');

// Always clear any existing background and restart the fade
glow.removeAttribute('style');
glow.className = '';
glow.style.position = 'absolute';
glow.style.top = '0';
glow.style.left = '0';
glow.style.width = '100%';
glow.style.height = '100%';
glow.style.pointerEvents = 'none';
glow.style.zIndex = '10010';
glow.style.opacity = '0';  // reset before fade-in

// Add background for current direction
glow.style.background = directionBackground(direction);

// Force reflow to trigger transition
void glow.offsetWidth;

// Fade in
glow.style.opacity = '1';


  setTimeout(() => {
    glow.style.opacity = '0';
    setTimeout(() => {
      glow.style.display = 'none';
    }, 500); // wait for fade-out
  }, 2000); // display for 2s
}


function directionBackground(direction) {
  const strong = 'rgba(78, 247, 83, 0.85)';  // brighter center
  const soft = 'rgba(255,255,180,0.25)';    // dimmer outer edge
  const spread = '20%'; // tighter glow (was 80%)

  switch (direction) {
    case 'North':
      return `radial-gradient(ellipse at 50% 0%, ${strong} 0%, ${soft} ${spread}, transparent 100%)`;
    case 'Northeast':
      return `radial-gradient(ellipse at 100% 0%, ${strong} 0%, ${soft} ${spread}, transparent 100%)`;
    case 'East':
      return `radial-gradient(ellipse at 100% 50%, ${strong} 0%, ${soft} ${spread}, transparent 100%)`;
    case 'Southeast':
      return `radial-gradient(ellipse at 100% 100%, ${strong} 0%, ${soft} ${spread}, transparent 100%)`;
    case 'South':
      return `radial-gradient(ellipse at 50% 100%, ${strong} 0%, ${soft} ${spread}, transparent 100%)`;
    case 'Southwest':
      return `radial-gradient(ellipse at 0% 100%, ${strong} 0%, ${soft} ${spread}, transparent 100%)`;
    case 'West':
      return `radial-gradient(ellipse at 0% 50%, ${strong} 0%, ${soft} ${spread}, transparent 100%)`;
    case 'Northwest':
      return `radial-gradient(ellipse at 0% 0%, ${strong} 0%, ${soft} ${spread}, transparent 100%)`;
    default:
      return '';
  }
}





console.log("glow updated");  // <-- add this
  document.getElementById("closeInfoPanel").addEventListener("click", hideInfoPanel);
  startLevel1();

})();
