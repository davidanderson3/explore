(async function init() {
  const keysPressed = {};
  const projectiles = [];
  const enemyProjectiles = [];
  const enemies = [];
  let spawnPoint = null;
  let routeStart = null;
  let routeDestination = null;

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

  const overlayElements = {
    container: document.getElementById('startScreen'),
    button: document.getElementById('startGameButton'),
    countdown: document.getElementById('startCountdown'),
    message: document.getElementById('startScreenMessage')
  };
  const defaultOverlayMessage = overlayElements.message ? overlayElements.message.textContent : '';

  const COUNTDOWN_SEQUENCE = ['3', '2', '1', 'Go!'];
  const COUNTDOWN_DIGIT_MS = 250;
  const COUNTDOWN_GO_MS = 400;
  const OVERLAY_FADE_MS = 300;
  const MAP_FORWARD_OFFSET = 0.012;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const clampLatitude = (value) => Math.max(-85, Math.min(85, value));
  const normalizeLongitude = (value) => ((value + 180) % 360 + 360) % 360 - 180;

  function computeAheadCenter(lat, lng, headingRad) {
    const aheadLat = clampLatitude(lat + Math.cos(headingRad) * MAP_FORWARD_OFFSET);
    const aheadLng = normalizeLongitude(lng + Math.sin(headingRad) * MAP_FORWARD_OFFSET);
    return [aheadLat, aheadLng];
  }

  function prepareOverlay({ message, showButton }) {
    const { container, button, countdown, message: messageEl } = overlayElements;
    if (!container) return;

    container.classList.remove('hidden');
    container.style.display = 'flex';
    container.setAttribute('aria-hidden', 'false');

    if (messageEl) {
      if (typeof message === 'string') {
        messageEl.textContent = message;
      } else if (message === undefined) {
        messageEl.textContent = defaultOverlayMessage;
      }
    }

    if (countdown) {
      countdown.textContent = '';
    }

    if (button) {
      button.disabled = false;
      button.style.display = showButton ? 'inline-block' : 'none';
    }
  }

  async function playCountdown() {
    const { countdown } = overlayElements;
    if (!countdown) return;

    for (const value of COUNTDOWN_SEQUENCE) {
      countdown.textContent = value;
      const delay = value === 'Go!' ? COUNTDOWN_GO_MS : COUNTDOWN_DIGIT_MS;
      await sleep(delay);
    }
  }

  function hideOverlay() {
    const { container, countdown, button } = overlayElements;
    if (!container) return;

    container.classList.add('hidden');

    setTimeout(() => {
      container.style.display = 'none';
      container.setAttribute('aria-hidden', 'true');
      container.classList.remove('hidden');
      if (countdown) countdown.textContent = '';
      if (button) {
        button.disabled = false;
        button.style.display = 'inline-block';
      }
    }, OVERLAY_FADE_MS);
  }

  async function runCountdown({ showButton, message, autoStart }) {
    const { container, button } = overlayElements;
    if (!container) return;

    prepareOverlay({ message, showButton });

    if (showButton && button) {
      requestAnimationFrame(() => {
        if (document.activeElement !== button) {
          button.focus();
        }
      });

      await new Promise((resolve) => {
        const startSequence = async () => {
          button.removeEventListener('keydown', handleKeydown);
          button.disabled = true;
          await playCountdown();
          hideOverlay();
          resolve();
        };

        const handleKeydown = (event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !button.disabled) {
            event.preventDefault();
            button.click();
          }
        };

        button.addEventListener('keydown', handleKeydown);
        button.addEventListener('click', startSequence, { once: true });
      });
      return;
    }

    await new Promise((resolve) => {
      const startSequence = async () => {
        if (button) button.disabled = true;
        await playCountdown();
        hideOverlay();
        resolve();
      };

      const delay = autoStart ? 150 : 0;
      setTimeout(startSequence, delay);
    });
  }

  async function waitForGameStart() {
    await runCountdown({ showButton: true, autoStart: false });
  }

  async function runRespawnCountdown(message) {
    await runCountdown({ showButton: false, autoStart: true, message });
  }

  const citiesPromise = loadGeoJSON('assets/cities.geojson');

  await waitForGameStart();

  const cities = await citiesPromise;

  const cityFeatures = cities.features;
  const startCityIdx = Math.floor(Math.random() * cityFeatures.length);
  const startCity = cityFeatures[startCityIdx];

  // Find a nearby city (closest, but not the same)
  let minDist = Infinity;
  let destCity = null;
  let destCityIdx = null;
  for (let i = 0; i < cityFeatures.length; i++) {
    if (i === startCityIdx) continue;
    const c = cityFeatures[i];
    const dLat = c.geometry.coordinates[1] - startCity.geometry.coordinates[1];
    const dLng = c.geometry.coordinates[0] - startCity.geometry.coordinates[0];
    const dist = Math.hypot(dLat, dLng);
    if (dist < minDist) {
      minDist = dist;
      destCity = c;
      destCityIdx = i;
    }
  }

  // Show the message
  document.getElementById('missionMessage').textContent =
    `Mission starts in ${startCity.properties.NAME}. Your job is to get to ${destCity.properties.NAME}. Good luck!`;

  // Use startCity for your spawn point:
  const start = {
    lat: startCity.geometry.coordinates[1],
    lng: startCity.geometry.coordinates[0]
  };
  const destinationPoint = {
    lat: destCity.geometry.coordinates[1],
    lng: destCity.geometry.coordinates[0]
  };
  const GameState = { player: { lat: start.lat, lng: start.lng } };
  spawnPoint = { lat: start.lat, lng: start.lng };
  routeStart = { ...start };
  routeDestination = { ...destinationPoint };
  let difficultyLevel = 1;
  let stageCleared = false;
  let legTransitionInProgress = false;
  let lastCaptureWarningTs = 0;
  let currentStartIdx = startCityIdx;
  let currentDestIdx = destCityIdx ?? startCityIdx;
  const visitedCityIndices = new Set([startCityIdx]);
  let originGlowMarker = null;
  let destinationGlowMarker = null;
  let routeLineLayer = null;
  let totalHostilesThisStage = 0;
  let hostilesDestroyedThisStage = 0;

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

  let currentIcon = 'assets/car.png';
  const playerMarker = L.marker([GameState.player.lat, GameState.player.lng], {
    icon: L.divIcon({
      html: `<img src="${currentIcon}" style="width:40px;height:40px;transform: rotate(0deg); transform-origin: center center;">`,
      iconSize: [40, 40],
      className: ''
    })
  }).addTo(map);

  window.addEventListener('load', () => map.invalidateSize());
  window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 500));

  let carHeading = 0, carSpeed = 0, accelerating = false, lastFetchTime = 0;
  let touchTarget = null;

  ensureAheadView({ immediate: true });

  function ensureAheadView({ immediate = false } = {}) {
    const { lat, lng } = playerMarker.getLatLng();
    const headingRad = carHeading * Math.PI / 180;
    const [targetLat, targetLng] = computeAheadCenter(lat, lng, headingRad);

    const viewZoom = map.getZoom() ?? 15;
    map.setView([targetLat, targetLng], viewZoom, { animate: false });
  }

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

  const ENEMY_BASE_COUNT = 6;
  const ENEMY_COUNT_INCREMENT = 2;
  const ENEMY_JITTER = 0.01;
  const DESTINATION_CAPTURE_RADIUS = 0.0095;
  const ROUTE_RETURN_FORCE = 0.015;

  const ENEMY_TEMPLATES = {
    scout: {
      id: 'scout',
      label: 'Scout',
      health: 8,
      accelVariance: 0.00008,
      maxVelocity: 0.00065,
      maxDistance: 0.022,
      behavior: 'wander',
      hue: 120,
      size: 70,
      glowColor: 'rgba(96, 255, 168, 0.65)',
      collisionDamage: 1,
      fireChance: 0
    },
    gunner: {
      id: 'gunner',
      label: 'Gunner',
      health: 14,
      accelVariance: 0.00005,
      maxVelocity: 0.00045,
      maxDistance: 0.018,
      behavior: 'skirmisher',
      hue: 280,
      size: 78,
      glowColor: 'rgba(173, 102, 255, 0.65)',
      collisionDamage: 2,
      fireChance: 0.018,
      projectile: {
        speed: 0.00038,
        radius: 6,
        color: '#7b42ff',
        fillColor: '#b387ff',
        lifetime: 260,
        damage: 2,
        aim: 'player'
      }
    },
    charger: {
      id: 'charger',
      label: 'Charger',
      health: 12,
      accelVariance: 0.00007,
      maxVelocity: 0.0007,
      maxDistance: 0.024,
      behavior: 'charger',
      chargeIntensity: 0.00012,
      engageRadius: 0.035,
      hue: 40,
      size: 76,
      glowColor: 'rgba(255, 184, 77, 0.65)',
      collisionDamage: 3,
      fireChance: 0
    },
    tank: {
      id: 'tank',
      label: 'Siege',
      health: 24,
      accelVariance: 0.00003,
      maxVelocity: 0.00028,
      maxDistance: 0.016,
      behavior: 'wander',
      hue: 0,
      size: 88,
      glowColor: 'rgba(255, 92, 92, 0.6)',
      collisionDamage: 4,
      fireChance: 0.012,
      projectile: {
        speed: 0.0003,
        radius: 9,
        color: '#ff4d4d',
        fillColor: '#ff9a9a',
        lifetime: 340,
        damage: 4,
        aim: 'player'
      }
    }
  };

  const STAGE_TYPE_TABLE = [
    ['scout', 'gunner'],
    ['scout', 'gunner', 'charger'],
    ['scout', 'gunner', 'charger', 'tank']
  ];

  function updateEnemyHealthVisual(enemy) {
    if (!enemy.healthBar) return;
    const healthRatio = Math.max(enemy.health, 0) / enemy.maxHealth;
    const barLng1 = enemy.lng - 0.002;
    const barLng2 = enemy.lng - 0.002 + 0.004 * healthRatio;
    enemy.healthBar.setBounds([
      [enemy.lat + 0.004, barLng1],
      [enemy.lat + 0.0044, barLng2]
    ]);
    enemy.healthBar.bringToFront();
  }

  function removeEnemy(enemy) {
    if (enemy.marker) map.removeLayer(enemy.marker);
    if (enemy.healthBar) map.removeLayer(enemy.healthBar);
    const idx = enemies.indexOf(enemy);
    if (idx !== -1) enemies.splice(idx, 1);
  }

  function spawnEnemyAt(lat, lng, typeKey = 'gunner') {
    const clampedLat = clampLatitude(lat);
    const normalizedLng = normalizeLongitude(lng);
    const template = ENEMY_TEMPLATES[typeKey] || ENEMY_TEMPLATES.gunner;

    const enemy = {
      type: template.id,
      template,
      centerLat: clampedLat,
      centerLng: normalizedLng,
      lat: clampedLat,
      lng: normalizedLng,
      health: template.health,
      maxHealth: template.health,
      velLat: 0,
      velLng: 0,
      marker: null,
      healthBar: null,
      collisionDamage: template.collisionDamage ?? 1
    };

    enemy.marker = L.marker([enemy.lat, enemy.lng], {
      icon: createEnemyIcon(template)
    }).addTo(map);

    const barColor = template.healthBarColor || template.glowColor || "#800000";

    enemy.healthBar = L.rectangle([
      [enemy.lat + 0.004, enemy.lng - 0.002],
      [enemy.lat + 0.0044, enemy.lng + 0.002]
    ], {
      color: barColor,
      weight: 2,
      fillColor: barColor,
      fillOpacity: 0.85
    }).addTo(map);

    updateEnemyHealthVisual(enemy);
    enemies.push(enemy);
    return enemy;
  }

  function interpolateRoutePoint(t) {
    if (!routeStart || !routeDestination) return { lat: GameState.player.lat, lng: GameState.player.lng };
    const baseLat = routeStart.lat + (routeDestination.lat - routeStart.lat) * t;
    const baseLng = routeStart.lng + (routeDestination.lng - routeStart.lng) * t;
    return {
      lat: baseLat,
      lng: baseLng
    };
  }

  function moveEnemies() {
    const playerPos = playerMarker.getLatLng();
    enemies.forEach((enemy) => {
      const template = enemy.template || ENEMY_TEMPLATES.gunner;
      const variance = template.accelVariance ?? 0.00004;
      const maxVelocity = template.maxVelocity ?? 0.0004;
      const maxDistance = template.maxDistance ?? 0.018;
      const behavior = template.behavior ?? 'wander';

      enemy.velLat += (Math.random() - 0.5) * variance;
      enemy.velLng += (Math.random() - 0.5) * variance;

      if (behavior === 'charger') {
        const dLatPlayer = playerPos.lat - enemy.lat;
        const dLngPlayer = playerPos.lng - enemy.lng;
        enemy.velLat += dLatPlayer * (template.chargeIntensity ?? 0.00008);
        enemy.velLng += dLngPlayer * (template.chargeIntensity ?? 0.00008);
      }

      enemy.velLat = Math.max(-maxVelocity, Math.min(maxVelocity, enemy.velLat));
      enemy.velLng = Math.max(-maxVelocity, Math.min(maxVelocity, enemy.velLng));

      enemy.lat = clampLatitude(enemy.lat + enemy.velLat);
      enemy.lng = normalizeLongitude(enemy.lng + enemy.velLng);

      const dLat = enemy.lat - enemy.centerLat;
      const dLng = enemy.lng - enemy.centerLng;
      if (Math.hypot(dLat, dLng) > maxDistance) {
        enemy.velLat -= dLat * ROUTE_RETURN_FORCE;
        enemy.velLng -= dLng * ROUTE_RETURN_FORCE;
      }

      if (enemy.marker) enemy.marker.setLatLng([enemy.lat, enemy.lng]);
      updateEnemyHealthVisual(enemy);
    });
  }

  function handleEnemyHitByProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i];
      let hitEnemy = null;

      for (let j = enemies.length - 1; j >= 0; j--) {
        const enemy = enemies[j];
        if (Math.hypot(projectile.lat - enemy.lat, projectile.lng - enemy.lng) < 0.004) {
          hitEnemy = enemy;
          break;
        }
      }

      if (!hitEnemy) continue;

      hitEnemy.health -= 1;
      if (hitEnemy.health <= 0) {
        removeEnemy(hitEnemy);
        registerEnemyDestroyed();
        checkStageCleared();
      } else {
        updateEnemyHealthVisual(hitEnemy);
      }

      map.removeLayer(projectile.marker);
      projectiles.splice(i, 1);
    }
  }

  function spawnEnemyProjectile(enemy) {
    const template = enemy.template;
    if (!template || !template.projectile) return;

    const projectileCfg = template.projectile;
    let headingRad;
    if (projectileCfg.aim === 'player') {
      const playerPos = playerMarker.getLatLng();
      headingRad = Math.atan2(playerPos.lng - enemy.lng, playerPos.lat - enemy.lat);
      headingRad += (Math.random() - 0.5) * 0.2;
    } else {
      headingRad = Math.random() * Math.PI * 2;
    }

    const speed = projectileCfg.speed ?? 0.0003;

    const projectile = {
      lat: enemy.lat,
      lng: enemy.lng,
      dx: speed * Math.sin(headingRad),
      dy: speed * Math.cos(headingRad),
      damage: projectileCfg.damage ?? 3,
      lifetime: projectileCfg.lifetime ?? 300,
      marker: L.circleMarker([enemy.lat, enemy.lng], {
        radius: projectileCfg.radius ?? 7,
        color: projectileCfg.color ?? '#ff00ff',
        fillColor: projectileCfg.fillColor ?? projectileCfg.color ?? '#ff00ff',
        fillOpacity: 0.85,
        weight: 2
      }).addTo(map)
    };

    enemyProjectiles.push(projectile);
  }

  function enemiesShootProjectiles() {
    const fireBoost = 1 + (difficultyLevel - 1) * 0.25;
    enemies.forEach((enemy) => {
      const template = enemy.template;
      if (!template || !template.fireChance || !template.projectile) return;
      if (Math.random() < template.fireChance * fireBoost) {
        spawnEnemyProjectile(enemy);
      }
    });
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

  const playerMaxHealth = 5;
  let playerHealth = playerMaxHealth;
  const STARTING_LIVES = 3;
  let playerLives = STARTING_LIVES;
  let respawnInProgress = false;

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

  function updateLivesDisplay() {
    const livesEl = document.getElementById('livesDisplay');
    if (livesEl) {
      livesEl.textContent = `Lives: ${Math.max(playerLives, 0)}`;
    }
  }

  updatePlayerHealthBar();
  updateLivesDisplay();

  const initialEnemyCount = startLeg({
    startIdx: currentStartIdx,
    destIdx: currentDestIdx,
    resetPlayerPosition: true,
    healPlayer: true
  });
  setMissionMessage(`Stage ${difficultyLevel}: Eliminate ${initialEnemyCount} hostiles between ${getCityName(currentStartIdx)} and ${getCityName(currentDestIdx)}.`);

  function resetProjectiles() {
    for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
      map.removeLayer(enemyProjectiles[i].marker);
    }
    enemyProjectiles.length = 0;

    for (let i = projectiles.length - 1; i >= 0; i--) {
      map.removeLayer(projectiles[i].marker);
    }
    projectiles.length = 0;
  }

  async function handlePlayerDeath(reason) {
    if (respawnInProgress) return;
    respawnInProgress = true;

    playerLives -= 1;
    if (playerLives < 0) playerLives = 0;
    updateLivesDisplay();

    playerHealth = playerMaxHealth;
    updatePlayerHealthBar();

    carSpeed = 0;
    accelerating = false;
    touchTarget = null;
    Object.keys(keysPressed).forEach((key) => {
      keysPressed[key] = false;
    });

    resetProjectiles();

    const respawnLat = (spawnPoint && spawnPoint.lat) || GameState.player.lat;
    const respawnLng = (spawnPoint && spawnPoint.lng) || GameState.player.lng;
    const respawnLatLng = L.latLng(respawnLat, respawnLng);
    playerMarker.setLatLng(respawnLatLng);
    GameState.player.lat = respawnLat;
    GameState.player.lng = respawnLng;
    carHeading = 0;
    ensureAheadView({ immediate: true });

    const remainingLives = playerLives;
    const message = remainingLives > 0
      ? `${reason} Lives remaining: ${remainingLives}`
      : `${reason} Out of lives! Restarting...`;

    await runRespawnCountdown(message);

    if (remainingLives <= 0) {
      playerLives = STARTING_LIVES;
      updateLivesDisplay();
    }

    respawnInProgress = false;
    requestAnimationFrame(updateCarPosition);
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

      const now = Date.now();
      if (now - lastFetchTime > 3000) {
        lastFetchTime = now;
        fetchWikipediaContent(newLat, newLng);
      }

      GameState.player.lat = newLat;
      GameState.player.lng = newLng;
      ensureAheadView();

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
          playerHealth -= p.damage ?? 3;
          updatePlayerHealthBar();
          map.removeLayer(p.marker);
          enemyProjectiles.splice(i, 1);
          if (playerHealth <= 0) {
            await handlePlayerDeath('Enemy fire!');
            return;
          }
          continue;
        }
        if (--p.lifetime <= 0) {
          map.removeLayer(p.marker);
          enemyProjectiles.splice(i, 1);
        }
      }

      enemiesShootProjectiles();
      moveEnemies();
      handleEnemyHitByProjectiles();

      const playerPos = playerMarker.getLatLng();
      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const distToUFO = Math.hypot(playerPos.lat - enemy.lat, playerPos.lng - enemy.lng);
        if (distToUFO < 0.0025) { // touching range
          playerHealth -= enemy.collisionDamage ?? 1;
          updatePlayerHealthBar();
          const angleAway = Math.atan2(playerPos.lat - enemy.lat, playerPos.lng - enemy.lng);
          const bounceDist = 0.003;
          playerMarker.setLatLng([
            playerPos.lat + Math.sin(angleAway) * bounceDist,
            playerPos.lng + Math.cos(angleAway) * bounceDist
          ]);
          const bouncedPos = playerMarker.getLatLng();
          GameState.player.lat = bouncedPos.lat;
          GameState.player.lng = bouncedPos.lng;
          ensureAheadView();
          if (playerHealth <= 0) {
            await handlePlayerDeath('UFO collision!');
            return;
          }
        }
      }

      if (routeDestination) {
        const distanceToDest = Math.hypot(routeDestination.lat - newLat, routeDestination.lng - newLng);
        if (distanceToDest < DESTINATION_CAPTURE_RADIUS) {
          if (stageCleared || enemies.length === 0) {
            advanceToNextCity();
          } else {
            const nowTs = Date.now();
            if (nowTs - lastCaptureWarningTs > 2500) {
              const remaining = Math.max(totalHostilesThisStage - hostilesDestroyedThisStage, enemies.length);
              setMissionMessage(`Hostiles remain (${remaining} left). Eliminate all enemies before entering ${getCityName(currentDestIdx)}.`);
              lastCaptureWarningTs = nowTs;
            }
          }
        }
      }

      requestAnimationFrame(updateCarPosition);
    } catch (e) {
      console.error("💥 updateCarPosition error:", e);
    }

    const beaconTarget = routeDestination || routeStart || destinationPoint;
    if (beaconTarget) {
      updateBeacon(
        playerMarker.getLatLng().lat,
        playerMarker.getLatLng().lng,
        beaconTarget.lat,
        beaconTarget.lng
      );
    }
  }

  // Start the game loop
  updateCarPosition();

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
 
  function setMissionMessage(text) {
    const missionEl = document.getElementById('missionMessage');
    if (missionEl) missionEl.textContent = text;
  }

  function updateHostilesDisplay() {
    const hostilesEl = document.getElementById('hostilesDisplay');
    if (!hostilesEl) return;
    hostilesEl.textContent = `Hostiles neutralized: ${hostilesDestroyedThisStage} / ${totalHostilesThisStage}`;
  }

  function registerEnemyDestroyed() {
    hostilesDestroyedThisStage = Math.min(hostilesDestroyedThisStage + 1, totalHostilesThisStage);
    updateHostilesDisplay();
  }

  function getCityLatLng(index) {
    const feature = cityFeatures[index];
    if (!feature) return null;
    return {
      lat: feature.geometry.coordinates[1],
      lng: feature.geometry.coordinates[0]
    };
  }

  function getCityName(index) {
    const feature = cityFeatures[index];
    return feature ? feature.properties.NAME : 'Unknown City';
  }

  function getStageEnemyTypes(level) {
    const tableIndex = Math.min(STAGE_TYPE_TABLE.length - 1, Math.max(0, level - 1));
    return STAGE_TYPE_TABLE[tableIndex];
  }

  function getStageEnemyCount(level) {
    return ENEMY_BASE_COUNT + (level - 1) * ENEMY_COUNT_INCREMENT;
  }

  function createEnemyIcon(template) {
    const size = template.size ?? 80;
    const glowColor = template.glowColor ?? 'rgba(255,255,255,0.6)';
    const hue = template.hue ?? 0;
    const imageSize = Math.max(30, size - 18);
    return L.divIcon({
      className: 'enemy-marker',
      html: `
        <div style="position:relative;width:${size}px;height:${size}px;">
          <div style="position:absolute;top:50%;left:50%;width:100%;height:100%;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle, ${glowColor} 0%, rgba(0,0,0,0) 72%);opacity:0.78;"></div>
          <img src="assets/ufo.png" alt="" style="position:absolute;top:50%;left:50%;width:${imageSize}px;height:${imageSize}px;transform:translate(-50%,-50%);filter:hue-rotate(${hue}deg) saturate(1.25);">
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });
  }

  function clearExistingEnemies() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      removeEnemy(enemies[i]);
    }
  }

  function spawnStageEnemies() {
    clearExistingEnemies();

    if (!routeStart || !routeDestination) return;
    const count = getStageEnemyCount(difficultyLevel);
    const availableTypes = getStageEnemyTypes(difficultyLevel);

    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1);
      const basePoint = interpolateRoutePoint(t);
      const jitterLat = (Math.random() - 0.5) * ENEMY_JITTER;
      const jitterLng = (Math.random() - 0.5) * ENEMY_JITTER;
      const typeKey = availableTypes[Math.floor(Math.random() * availableTypes.length)];
      spawnEnemyAt(basePoint.lat + jitterLat, basePoint.lng + jitterLng, typeKey);
    }

    if (enemies.length === 0) checkStageCleared();
    return count;
  }

  function updateCityHighlights() {
    if (originGlowMarker) {
      map.removeLayer(originGlowMarker);
      originGlowMarker = null;
    }
    if (destinationGlowMarker) {
      map.removeLayer(destinationGlowMarker);
      destinationGlowMarker = null;
    }
    if (routeLineLayer) {
      map.removeLayer(routeLineLayer);
      routeLineLayer = null;
    }

    if (!routeStart || !routeDestination) return;

    originGlowMarker = L.marker([routeStart.lat, routeStart.lng], {
      interactive: false,
      icon: L.divIcon({
        className: 'city-glow origin-glow',
        html: '<div class="city-glow__pulse"></div>',
        iconSize: [180, 180],
        iconAnchor: [90, 90]
      })
    }).addTo(map);

    destinationGlowMarker = L.marker([routeDestination.lat, routeDestination.lng], {
      interactive: false,
      icon: L.divIcon({
        className: 'city-glow destination-glow',
        html: '<div class="city-glow__pulse"></div>',
        iconSize: [180, 180],
        iconAnchor: [90, 90]
      })
    }).addTo(map);

    routeLineLayer = L.polyline(
      [
        [routeStart.lat, routeStart.lng],
        [routeDestination.lat, routeDestination.lng]
      ],
      {
        color: '#55c2ff',
        weight: 3,
        dashArray: '10 12',
        opacity: 0.55,
        interactive: false
      }
    ).addTo(map);
    if (routeLineLayer.bringToBack) routeLineLayer.bringToBack();
  }

  function startLeg({ startIdx, destIdx, resetPlayerPosition = false, healPlayer = false }) {
    const startPoint = getCityLatLng(startIdx);
    const destPoint = getCityLatLng(destIdx);
    if (!startPoint || !destPoint) return;

    currentStartIdx = startIdx;
    currentDestIdx = destIdx;
    routeStart = { ...startPoint };
    routeDestination = { ...destPoint };
    spawnPoint = { ...startPoint };
    stageCleared = false;
    lastCaptureWarningTs = 0;
    updateCityHighlights();
    resetProjectiles();

    if (healPlayer) {
      playerHealth = playerMaxHealth;
      updatePlayerHealthBar();
    }

    if (resetPlayerPosition) {
      playerMarker.setLatLng([startPoint.lat, startPoint.lng]);
      GameState.player.lat = startPoint.lat;
      GameState.player.lng = startPoint.lng;
      ensureAheadView({ immediate: true });
    }

    const enemyCount = spawnStageEnemies();
    totalHostilesThisStage = enemyCount ?? 0;
    hostilesDestroyedThisStage = 0;
    updateHostilesDisplay();
    return enemyCount ?? 0;
  }

  function findNextDestinationIndex(fromIdx) {
    let bestIdx = null;
    let bestDist = Infinity;

    for (let i = 0; i < cityFeatures.length; i++) {
      if (i === fromIdx) continue;
      if (visitedCityIndices.has(i)) continue;
      const candidate = cityFeatures[i];
      const dLat = candidate.geometry.coordinates[1] - cityFeatures[fromIdx].geometry.coordinates[1];
      const dLng = candidate.geometry.coordinates[0] - cityFeatures[fromIdx].geometry.coordinates[0];
      const dist = Math.hypot(dLat, dLng);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx !== null) return bestIdx;

    for (let i = 0; i < cityFeatures.length; i++) {
      if (i === fromIdx) continue;
      const candidate = cityFeatures[i];
      const dLat = candidate.geometry.coordinates[1] - cityFeatures[fromIdx].geometry.coordinates[1];
      const dLng = candidate.geometry.coordinates[0] - cityFeatures[fromIdx].geometry.coordinates[0];
      const dist = Math.hypot(dLat, dLng);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    return bestIdx;
  }

  function advanceToNextCity() {
    if (legTransitionInProgress) return;
    legTransitionInProgress = true;

    visitedCityIndices.add(currentDestIdx);
    const nextDestIdx = findNextDestinationIndex(currentDestIdx);
    if (nextDestIdx === null || nextDestIdx === undefined) {
      setMissionMessage(`All cities secured! Mission accomplished.`);
      routeDestination = null;
      stageCleared = true;
      updateCityHighlights();
      legTransitionInProgress = false;
      return;
    }

    const completedLevel = difficultyLevel;
    difficultyLevel += 1;
    const enemyCount = startLeg({
      startIdx: currentDestIdx,
      destIdx: nextDestIdx,
      resetPlayerPosition: false,
      healPlayer: true
    });

    setMissionMessage(`Stage ${completedLevel} secure! New mission: depart ${getCityName(currentStartIdx)} for ${getCityName(currentDestIdx)}. Expect ${enemyCount} hostiles.`);
    stageCleared = false;
    legTransitionInProgress = false;
  }

  function checkStageCleared() {
    if (stageCleared) return;
    if (enemies.length > 0) return;
    stageCleared = true;
    const destName = getCityName(currentDestIdx);
    setMissionMessage(`Route clear! Proceed to ${destName}. Hostiles neutralized: ${hostilesDestroyedThisStage}/${totalHostilesThisStage}.`);
  }

  document.getElementById("closeInfoPanel").addEventListener("click", hideInfoPanel);

})();
