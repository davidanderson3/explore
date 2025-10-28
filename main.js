(async function init() {
  const keysPressed = {};
  const projectiles = [];
  const enemyProjectiles = [];
  const enemyBombs = [];
  const enemies = [];
  let spawnPoint = null;
  let routeStart = null;
  let routeDestination = null;
  let missionBaseText = '';
  let missionRevertTimer = null;
  let gamePaused = false;
  const wikiPlacemarks = [];
  let beaconTimer = 0;


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
    nextLevelButton: document.getElementById('nextLevelButton'),
    countdown: document.getElementById('startCountdown'), 
    message: document.getElementById('startScreenMessage')
  };
  const defaultOverlayMessage = overlayElements.message ? overlayElements.message.textContent : '';

  const COUNTDOWN_SEQUENCE = ['3', '2', '1', 'Go!'];
  const COUNTDOWN_DIGIT_MS = 250;
  const COUNTDOWN_GO_MS = 400; 
  const BASE_MAP_FORWARD_OFFSET = 0.012; // Original offset
  const SPEED_AHEAD_FACTOR = 0.0048; // How much more to look ahead per unit of carSpeed
  const OVERLAY_FADE_MS = 300;
  const MAP_FORWARD_OFFSET = 0.012;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const clampLatitude = (value) => Math.max(-85, Math.min(85, value));
  const normalizeLongitude = (value) => ((value + 180) % 360 + 360) % 360 - 180;

  function computeAheadCenter(lat, lng, headingRad) {
    const dynamicOffset = BASE_MAP_FORWARD_OFFSET + Math.abs(carSpeed) * SPEED_AHEAD_FACTOR;
    const aheadLat = clampLatitude(lat + Math.cos(headingRad) * dynamicOffset);
    const aheadLng = normalizeLongitude(lng + Math.sin(headingRad) * dynamicOffset);
    return [aheadLat, aheadLng];
  }

  function prepareOverlay({ message, showButton, buttonText }) {
    const { container, button, nextLevelButton, countdown, message: messageEl } = overlayElements;
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
      if (buttonText) {
        button.textContent = buttonText;
        button.style.display = showButton ? 'inline-block' : 'none';
        button.disabled = false;
        if (nextLevelButton) nextLevelButton.style.display = 'none';
      } else {
        button.style.display = showButton ? 'inline-block' : 'none';
        button.disabled = false;
        if (nextLevelButton) nextLevelButton.style.display = 'none';
      }
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
  let hostilesRequiredThisStage = 0;

  const powerUps = [];
  const DEFAULT_WEAPON = 'burst';
  let currentWeapon = 'burst';
  let weaponExpireTime = 0;
  const WEAPON_DURATION_MS = 25000;

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

  let currentIcon = 'assets/quad.png';
  const playerMarker = L.marker([GameState.player.lat, GameState.player.lng], {
    icon: L.divIcon({
      html: `<img src="${currentIcon}" style="width:50px;height:50px;transform: rotate(0deg); transform-origin: center center;">`,
      iconSize: [50, 50],
      className: 'player-marker'
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
    if (e.code === 'Space') fireCurrentWeapon();
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

  function fireSprayWeapon() {
    const { lat, lng } = playerMarker.getLatLng();
    const baseHeading = carHeading;
    const sprayCount = 5;
    const spraySpread = 32;
    const speed = 0.0045;

    for (let i = 0; i < sprayCount; i++) {
      const angle = baseHeading - spraySpread / 2 + (spraySpread / (sprayCount - 1)) * i;
      const headingRad = angle * Math.PI / 180;
      addPlayerProjectile({
        lat,
        lng,
        dx: speed * Math.sin(headingRad),
        dy: speed * Math.cos(headingRad),
        damage: 1, // Keep damage the same
        color: '#a00000', // Darker red
        fillColor: '#d00000', // Darker red fill
        radius: 4,
        lifetime: 110
      });
    }
  }

  function fireBurstWeapon() {
    const { lat, lng } = playerMarker.getLatLng();
    const baseHeading = carHeading;
    const offsetAngles = [-5, 0, 5];
    const speed = 0.006;

    offsetAngles.forEach((offset) => {
      const headingRad = (baseHeading + offset) * Math.PI / 180;
      addPlayerProjectile({
        lat,
        lng,
        dx: speed * Math.sin(headingRad),
        dy: speed * Math.cos(headingRad),
        damage: 1, // Keep damage the same
        color: '#a04000', // Darker orange
        fillColor: '#d06000', // Darker orange fill
        radius: 5,
        lifetime: 120
      });
    });
  }

  function fireBeamWeapon() {
    const { lat, lng } = playerMarker.getLatLng();
    const baseHeadingRad = carHeading * Math.PI / 180;
    for (let i = 0; i < 3; i++) {
      const speed = 0.008 + i * 0.0015;
      addPlayerProjectile({
        lat,
        lng,
        dx: speed * Math.sin(baseHeadingRad),
        dy: speed * Math.cos(baseHeadingRad),
        damage: 1, // Keep damage the same
        color: '#006080', // Darker cyan
        fillColor: '#0090c0', // Darker cyan fill
        radius: 3,
        lifetime: 140,
        fillOpacity: 0.8
      });
    }
  }

  function fireScatterWeapon() {
    const { lat, lng } = playerMarker.getLatLng();
    const baseHeading = carHeading;
    const scatterCount = 7;
    const scatterSpread = 90;
    const speed = 0.0042;

    for (let i = 0; i < scatterCount; i++) {
      const angle = baseHeading - scatterSpread / 2 + (scatterSpread / (scatterCount - 1)) * i;
      const headingRad = angle * Math.PI / 180;
      addPlayerProjectile({
        lat,
        lng,
        dx: speed * Math.sin(headingRad),
        dy: speed * Math.cos(headingRad),
        damage: 1, // Keep damage the same
        color: '#006000', // Darker green
        fillColor: '#009000', // Darker green fill
        radius: 4,
        lifetime: 115
      });
    }
  }

  function fireNovaWeapon() {
    const { lat, lng } = playerMarker.getLatLng();
    const novaCount = 10;
    const speed = 0.0035;

    for (let i = 0; i < novaCount; i++) {
      const angle = (360 / novaCount) * i;
      const headingRad = angle * Math.PI / 180;
      addPlayerProjectile({
        lat,
        lng,
        dx: speed * Math.sin(headingRad),
        dy: speed * Math.cos(headingRad),
        damage: 1, // Keep damage the same
        color: '#600080', // Darker purple
        fillColor: '#9000c0', // Darker purple fill
        radius: 3,
        lifetime: 120,
        fillOpacity: 0.85
      });
    }
  }

  function fireMissileWeapon() {
    const { lat, lng } = playerMarker.getLatLng();

    // Find the closest enemy
    let closestEnemy = null;
    let minDistance = Infinity;
    enemies.forEach(enemy => {
      const distance = Math.hypot(lat - enemy.lat, lng - enemy.lng);
      if (distance < minDistance) {
        minDistance = distance;
        closestEnemy = enemy;
      }
    });

    addPlayerProjectile({
      lat, lng, damage: 4, color: '#ff5722', fillColor: '#ffab91', radius: 6, lifetime: 400,
      seeking: true, target: closestEnemy, turnRate: 0.08, initialSpeed: 0.005
    });
  }

  function fireCurrentWeapon() {
    const weaponMap = {
      spray: fireSprayWeapon,
      burst: fireBurstWeapon,
      beam: fireBeamWeapon,
      scatter: fireScatterWeapon,
      nova: fireNovaWeapon,
      missile: fireMissileWeapon
    };
    (weaponMap[currentWeapon] || weaponMap[DEFAULT_WEAPON])();
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
      
      const wikiMarker = L.marker([page.lat, page.lon], {
        title: title
      }).addTo(map).bindPopup(
        `<strong>${title}</strong><br><a href="https://en.wikipedia.org/wiki/${urlTitle}" target="_blank">Open on Wikipedia</a>`
      );

      const already = wikiPlacemarks.some(p => Math.hypot(p.lat - page.lat, p.lng - page.lon) < 1e-5);
      if (!already) {
        wikiPlacemarks.push({
          lat: page.lat,
          lng: page.lon,
          title,
          marker: wikiMarker,
          consumed: false
        });
      }

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

      document.getElementById("infoContent").innerHTML = `<h3>${title}</h3>${imgHtml}
  <p>${extract}</p>
  <a href="https://en.wikipedia.org/wiki/${urlTitle}" target="_blank">Read more on Wikipedia</a>
`;

      showInfoPanel();


    } catch (err) {
      console.error("🚨 Wikipedia fetch error:", err);
      document.getElementById("infoPanel").style.display = "none";
    }
  }

  const ENEMY_BASE_COUNT = 15;
  const ENEMY_PROJECTILE_SPEED_SCALE = 0.4;
  const ENEMY_COUNT_INCREMENT = 12;
  const ENEMY_JITTER = 0.01;
  const DESTINATION_CAPTURE_RADIUS = 0.0095;
  const ROUTE_RETURN_FORCE = 0.015;
  const HEAL_ON_WIKI_RADIUS = 0.0032;  // distance threshold for pickup

  const ENEMY_TEMPLATES = {
    scout: {
      id: 'scout',
      label: 'Scout',
      health: 4,
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
      health: 7,
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
        radius: 6, // Keep radius the same
        color: '#400080', // Darker purple
        fillColor: '#6000b0', // Darker purple fill
        lifetime: 260,
        damage: 1,
        aim: 'player',
        targetJitter: 0.24
      }
    },
    sniper: {
      id: 'sniper',
      label: 'Sniper',
      health: 5,
      accelVariance: 0.00004,
      maxVelocity: 0.0005,
      maxDistance: 0.02,
      behavior: 'skirmisher',
      hue: 200,
      size: 74,
      glowColor: 'rgba(84, 220, 255, 0.65)',
      collisionDamage: 2,
      fireChance: 0.022,
      projectile: {
        speed: 0.0006,
        radius: 5, // Keep radius the same
        color: '#004080', // Darker blue
        fillColor: '#0060b0', // Darker blue fill
        lifetime: 380,
        damage: 1,
        aim: 'player',
        targetJitter: 0.08
      }
    },
    charger: {
      id: 'charger',
      label: 'Charger',
      health: 7,
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
    interceptor: {
      id: 'interceptor',
      label: 'Interceptor',
      health: 6,
      accelVariance: 0.00009,
      maxVelocity: 0.00075,
      maxDistance: 0.027,
      behavior: 'interceptor',
      interceptForce: 0.00009,
      lateralDrift: 0.00004,
      hue: 320,
      size: 72,
      glowColor: 'rgba(250, 105, 255, 0.65)',
      collisionDamage: 1,
      fireChance: 0.014,
      projectile: {
        speed: 0.00038,
        radius: 5, // Keep radius the same
        color: '#800080', // Darker magenta
        fillColor: '#b000b0', // Darker magenta fill
        lifetime: 260,
        damage: 1,
        aim: 'player',
        burstCount: 2,
        burstSpread: 14 * Math.PI / 180,
        targetJitter: 0.18,
        randomJitter: 0.08
      }
    },
    bomber: {
      id: 'bomber',
      label: 'Bomber',
      health: 10,
      accelVariance: 0.00005,
      maxVelocity: 0.00032,
      maxDistance: 0.02,
      behavior: 'wander',
      hue: 30,
      size: 86,
      glowColor: 'rgba(255, 155, 66, 0.65)',
      collisionDamage: 3,
      fireChance: 0,
      bomb: {
        chance: 0.65,
        cooldownMs: 3500,
        radius: 18,
        color: '#ff914d',
        fillColor: '#ffcf8f',
        fillOpacity: 0.55,
        triggerRadius: 0.0034,
        disarmRadius: 0.0038,
        damage: 1,
        lifetimeMs: 10000
      }
    },
    tank: {
      id: 'tank',
      label: 'Siege',
      health: 14,
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
        radius: 9, // Keep radius the same
        color: '#a00000', // Darker red
        fillColor: '#d00000', // Darker red fill
        lifetime: 340,
        damage: 1,
        aim: 'player',
        burstCount: 2,
        burstSpread: 12 * Math.PI / 180,
        targetJitter: 0.15
      }
    }
  };

  const STAGE_TYPE_TABLE = [
    ['scout'], // Level 1
    ['scout'], // Level 2
    ['scout', 'gunner'], // Level 3
    ['scout', 'gunner'], // Level 4
    ['scout', 'gunner', 'charger'], // Level 5
    ['gunner', 'charger', 'sniper'], // Level 6
    ['gunner', 'charger', 'sniper', 'interceptor'], // Level 7
    ['charger', 'sniper', 'interceptor', 'bomber'], // Level 8
    ['gunner', 'charger', 'sniper', 'interceptor', 'bomber', 'tank'] // Level 9+
  ];

  const POWERUP_TYPES = {
    spray: {
      weapon: 'spray',
      label: 'Wide Spray',
      shortLabel: 'S',
      color: '#ff7f97',
      duration: 28000,
      rarity: 10, // Common
    },
    burst: {
      weapon: 'burst',
      label: 'Burst Cannon',
      shortLabel: 'B',
      color: '#ffb347',
      duration: 0, // Default weapon
      spawnable: false,
    },
    beam: {
      weapon: 'beam',
      label: 'Solar Beam',
      shortLabel: 'L',
      color: '#6ce4ff',
      duration: 22000,
      rarity: 8, // Common
    },
    nova: {
      weapon: 'nova',
      label: 'Nova Ring',
      shortLabel: 'N',
      color: '#b57bff',
      duration: 24000,
      rarity: 6, // Uncommon
    },
    scatter: {
      weapon: 'scatter',
      label: 'Scatter Shot',
      shortLabel: 'X',
      color: '#2b6f42ff',
      duration: 26000,
      rarity: 8, // Common
    },
    missile: {
      weapon: 'missile',
      label: 'Seeker Missile',
      shortLabel: 'M',
      color: '#ff5722',
      duration: 35000,
      rarity: 2, // Rare
    }
  };

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
      collisionDamage: template.collisionDamage ?? 1,
      lastBombTime: 0
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
    const nowMs = Date.now();
    const playerPos = playerMarker.getLatLng();
    const stageVelocityScale = Math.min(1.15, 0.35 + difficultyLevel * 0.13);
    const stageVarianceScale = Math.min(1, 0.6 + (difficultyLevel - 1) * 0.15);
    enemies.forEach((enemy) => {
      const template = enemy.template || ENEMY_TEMPLATES.gunner;
      const varianceBase = template.accelVariance ?? 0.00004;
      const variance = varianceBase * stageVarianceScale;
      const baseMaxVelocity = template.maxVelocity ?? 0.0004;
      const maxVelocity = baseMaxVelocity * stageVelocityScale;
      const maxDistance = template.maxDistance ?? 0.018;
      const behavior = template.behavior ?? 'wander';

      enemy.velLat += (Math.random() - 0.5) * variance;
      enemy.velLng += (Math.random() - 0.5) * variance;

      if (behavior === 'charger' || behavior === 'interceptor') {
        const dLatPlayer = playerPos.lat - enemy.lat;
        const dLngPlayer = playerPos.lng - enemy.lng;
        const baseForce = behavior === 'charger'
          ? (template.chargeIntensity ?? 0.00008)
          : (template.interceptForce ?? 0.00006);
        const force = baseForce * stageVelocityScale;
        enemy.velLat += dLatPlayer * force;
        enemy.velLng += dLngPlayer * force;
        if (behavior === 'interceptor') {
          const lateral = (template.lateralDrift ?? 0.00004) * stageVelocityScale;
          enemy.velLat += -dLngPlayer * lateral;
          enemy.velLng += dLatPlayer * lateral;
        }
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

      if (template.bomb) {
        const cooldown = template.bomb.cooldownMs ?? 4000;
        if (nowMs - (enemy.lastBombTime ?? 0) >= cooldown) {
          if (Math.random() < (template.bomb.chance ?? 0.5)) {
            spawnEnemyBomb(enemy);
          }
          enemy.lastBombTime = nowMs;
        }
      }
    });
  }

  function handleEnemyHitByProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const projectile = projectiles[i];
      let handled = false;
      let hitEnemy = null;

      for (let j = enemies.length - 1; j >= 0; j--) {
        const enemy = enemies[j];
        if (Math.hypot(projectile.lat - enemy.lat, projectile.lng - enemy.lng) < 0.004) {
          hitEnemy = enemy;
          break;
        }
      }

      if (hitEnemy) {
        const projectileDamage = projectile.damage ?? 1;
        hitEnemy.health -= projectileDamage;
        if (hitEnemy.health <= 0) {
          triggerEnemyExplosion(hitEnemy);
          maybeSpawnPowerUp(hitEnemy.lat, hitEnemy.lng);
          removeEnemy(hitEnemy);
          registerEnemyDestroyed();
          checkStageCleared();
        } else {
          updateEnemyHealthVisual(hitEnemy);
        }
        handled = true;
      } else {
        for (let j = enemyBombs.length - 1; j >= 0; j--) {
          const bomb = enemyBombs[j];
          if (Math.hypot(projectile.lat - bomb.lat, projectile.lng - bomb.lng) < (bomb.disarmRadius ?? 0.0035)) {
            map.removeLayer(bomb.marker);
            enemyBombs.splice(j, 1);
            handled = true;
            break;
          }
        }
      }

      if (!handled) continue;

      map.removeLayer(projectile.marker);
      projectiles.splice(i, 1);
    }
  }

  function spawnEnemyBomb(enemy) {
    const template = enemy.template;
    if (!template || !template.bomb) return;

    const bombCfg = template.bomb;
    const marker = L.circleMarker([enemy.lat, enemy.lng], {
      radius: bombCfg.radius ?? 16,
      color: bombCfg.color ?? '#ff7300',
      fillColor: bombCfg.fillColor ?? '#ffc66b',
      fillOpacity: bombCfg.fillOpacity ?? 0.6,
      weight: 2,
      className: 'enemy-bomb',
      interactive: false
    }).addTo(map);

    enemyBombs.push({
      lat: enemy.lat,
      lng: enemy.lng,
      damage: bombCfg.damage ?? 3,
      triggerRadius: bombCfg.triggerRadius ?? 0.0032,
      disarmRadius: bombCfg.disarmRadius ?? 0.0036,
      expiresAt: Date.now() + (bombCfg.lifetimeMs ?? 8000),
      marker
    });
  }

function spawnEnemyProjectile(enemy) {
  const template = enemy.template;
  if (!template || !template.projectile) return;

  const projectileCfg = template.projectile;

  // Aim
  let baseHeading;
  if (projectileCfg.aim === 'player') {
    const playerPos = playerMarker.getLatLng();
    baseHeading = Math.atan2(playerPos.lng - enemy.lng, playerPos.lat - enemy.lat);
    baseHeading += (Math.random() - 0.5) * (projectileCfg.targetJitter ?? 0.2);
  } else {
    baseHeading = Math.random() * Math.PI * 2;
  }

  // Apply global slow-down
  const speed = ((projectileCfg.speed ?? 0.0003) * (typeof ENEMY_PROJECTILE_SPEED_SCALE === 'number' ? ENEMY_PROJECTILE_SPEED_SCALE : 1)) * (1 + (difficultyLevel - 1) * 0.1);

  const burstCount = Math.max(1, projectileCfg.burstCount ?? 1);
  const spread = projectileCfg.burstSpread ?? 0;
  const randomJitter = projectileCfg.randomJitter ?? 0;

  for (let shot = 0; shot < burstCount; shot++) {
    const offset = spread * (shot - (burstCount - 1) / 2);
    const headingRad = baseHeading + offset + (Math.random() - 0.5) * randomJitter;

    const projectile = {
      lat: enemy.lat,
      lng: enemy.lng,
      dx: speed * Math.sin(headingRad),
      dy: speed * Math.cos(headingRad),
      damage: projectileCfg.damage ?? 3,
      lifetime: projectileCfg.lifetime ?? 300,
      marker: L.circleMarker([enemy.lat, enemy.lng], {
        radius: projectileCfg.radius ?? 7,
        color: projectileCfg.color ?? '#800080', // Darker default for enemy projectiles
        fillColor: projectileCfg.fillColor ?? projectileCfg.color ?? '#b000b0', // Darker default fill
        fillOpacity: 0.85,
        weight: 2
      }).addTo(map)
    };

    enemyProjectiles.push(projectile);
  }
}


  function enemiesShootProjectiles() {
    const fireBoost = 1 + (difficultyLevel - 1) * 0.18;
    enemies.forEach((enemy) => {
      const template = enemy.template;
      if (!template || !template.fireChance || !template.projectile) return;
      if (Math.random() < template.fireChance * fireBoost) {
        spawnEnemyProjectile(enemy);
      }
    });
  }

  const playerMaxHealth = 5;
  let playerHealth = playerMaxHealth;
  const STARTING_LIVES = 20;
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
  setMissionMessage(`Stage ${difficultyLevel}: Neutralize ${hostilesRequiredThisStage} of ${initialEnemyCount} hostiles between ${getCityName(currentStartIdx)} and ${getCityName(currentDestIdx)}.`);
  setMissionBaseMessage(`Stage ${difficultyLevel}: Neutralize ${hostilesRequiredThisStage} of ${initialEnemyCount} hostiles between ${getCityName(currentStartIdx)} and ${getCityName(currentDestIdx)}.`);

  function clearEnemyBombs() {
    for (let i = enemyBombs.length - 1; i >= 0; i--) {
      map.removeLayer(enemyBombs[i].marker);
    }
    enemyBombs.length = 0;
  }

  function resetProjectiles() {
    for (let i = enemyProjectiles.length - 1; i >= 0; i--) {
      map.removeLayer(enemyProjectiles[i].marker);
    }
    enemyProjectiles.length = 0;

    for (let i = projectiles.length - 1; i >= 0; i--) {
      map.removeLayer(projectiles[i].marker);
    }
    projectiles.length = 0;
    clearEnemyBombs();
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
    currentWeapon = DEFAULT_WEAPON;
    weaponExpireTime = 0;
    updateWeaponDisplay();

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
      ? `${reason} Lives remaining: ${remainingLives}.`
      : `Game Over.`;

    await runRespawnCountdown(message);

    if (remainingLives <= 0) {
      prepareOverlay({ message: 'Game Over. Refresh the page to play again.', showButton: false });
      gamePaused = true; // Permanently pause the game
      return; // Stop the respawn process
    }

    respawnInProgress = false;
    requestAnimationFrame(updateCarPosition);
  }

  async function updateCarPosition() {
    try {
      if (gamePaused) return;
      const latlng = playerMarker.getLatLng();
      let newLat = latlng.lat;
      let newLng = latlng.lng;

      if (keysPressed['ArrowLeft']) carHeading -= 2;
      if (keysPressed['ArrowRight']) carHeading += 2;
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

      playerMarker.setLatLng([newLat, newLng]);
      const iconElement = playerMarker.getElement();
      if (iconElement instanceof HTMLElement) {
        const img = iconElement.querySelector('img');
        if (img) {
          // --- Homing missile logic ---
          for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            if (p.seeking && p.target && p.target.health > 0) {
              const targetAngle = Math.atan2(p.target.lng - p.lng, p.target.lat - p.lat);
              const currentAngle = Math.atan2(p.dx, p.dy);
              let angleDiff = targetAngle - currentAngle;
              while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
              while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

              const turnAmount = Math.max(-p.turnRate, Math.min(p.turnRate, angleDiff));
              const newAngle = currentAngle + turnAmount;
              const speed = Math.hypot(p.dx, p.dy);
              p.dx = Math.sin(newAngle) * speed;
              p.dy = Math.cos(newAngle) * speed;
            } else if (p.seeking) {
              // Target is gone, fly straight
              p.seeking = false;
            }
          }
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
      checkPowerUpPickup(newLat, newLng);
      handleWeaponExpiry(now);

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

      for (let i = enemyBombs.length - 1; i >= 0; i--) {
        const bomb = enemyBombs[i];
        if (now > bomb.expiresAt) {
          map.removeLayer(bomb.marker);
          enemyBombs.splice(i, 1);
          continue;
        }

        if (Math.hypot(playerPos.lat - bomb.lat, playerPos.lng - bomb.lng) < bomb.triggerRadius) {
          playerHealth -= bomb.damage ?? 3;
          updatePlayerHealthBar();
          map.removeLayer(bomb.marker);
          enemyBombs.splice(i, 1);
          if (playerHealth <= 0) {
            await handlePlayerDeath('Bomber trap!');
            return;
          }
        }
      }

      if (routeDestination) {
        const distanceToDest = Math.hypot(routeDestination.lat - newLat, routeDestination.lng - newLng);
        if (distanceToDest < DESTINATION_CAPTURE_RADIUS) {
          if ((stageCleared || enemies.length === 0) && !legTransitionInProgress) {
            advanceToNextCity();
          } else {
            const nowTs = Date.now();
            if (nowTs - lastCaptureWarningTs > 2500) {
              const requiredRemaining = Math.max(hostilesRequiredThisStage - hostilesDestroyedThisStage, 0);
              const contacts = Math.max(requiredRemaining, enemies.length);
              showTemporaryMessage(`Objective incomplete: neutralize ${requiredRemaining} more hostiles before entering ${getCityName(currentDestIdx)}. Sensors show ${contacts} contacts nearby.`, 3500);
              lastCaptureWarningTs = nowTs;
            }
          }
        }
      }

      // —— Heal pickup from Wikipedia placemarks ——
      for (let i = 0; i < wikiPlacemarks.length; i++) {
        const wp = wikiPlacemarks[i];
        if (wp.consumed) continue;
        if (Math.hypot(playerPos.lat - wp.lat, playerPos.lng - wp.lng) < HEAL_ON_WIKI_RADIUS) {
          // Full heal
          playerHealth = playerMaxHealth;
          updatePlayerHealthBar();

          // One-time pickup: mark consumed and remove the marker
          wp.consumed = true;
          if (wp.marker) {
            map.removeLayer(wp.marker);
            wp.marker = null;
          }

          // Small visual 'heal' pulse
          const healPulse = L.circleMarker([wp.lat, wp.lng], {
            radius: 18,
            color: '#43e97b',
            fillColor: '#38f9d7',
            fillOpacity: 0.7,
            weight: 2
          }).addTo(map);

          let steps = 0;
          const maxSteps = 12;
          const t = setInterval(() => {
            steps++;
            healPulse.setStyle({ radius: 18 + steps * 2, opacity: 1 - steps / maxSteps, fillOpacity: 0.7 * (1 - steps / maxSteps) });
            if (steps >= maxSteps) { clearInterval(t); map.removeLayer(healPulse); }
          }, 30);
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

function setMissionBaseMessage(text) {
  missionBaseText = text;
  setMissionMessage(text);
}

function showTemporaryMessage(text, ms = 3000) {
  setMissionMessage(text);
  if (missionRevertTimer) clearTimeout(missionRevertTimer);
  missionRevertTimer = setTimeout(() => {
    setMissionMessage(missionBaseText);
    missionRevertTimer = null;
  }, ms);
}


  function updateHostilesDisplay() {
    const hostilesEl = document.getElementById('hostilesDisplay');
    if (!hostilesEl) return;
    if (!totalHostilesThisStage) {
      hostilesEl.textContent = `Hostiles neutralized: 0 / 0`;
      return;
    }
    const requirement = hostilesRequiredThisStage || totalHostilesThisStage;
    const displayed = Math.min(hostilesDestroyedThisStage, requirement);
    hostilesEl.textContent = `Hostiles neutralized: ${displayed} / ${requirement}`;
  }

  function registerEnemyDestroyed() {
    hostilesDestroyedThisStage += 1;
    updateHostilesDisplay();
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
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

  function createPowerUpIcon(template) {
    const color = template.color ?? '#ffd966';
    const short = template.shortLabel ?? 'P';
    return L.divIcon({
      className: 'powerup-marker',
      html: `
        <div class="powerup-marker__icon" style="background:${color}; box-shadow:0 0 16px ${color}90;">${short}</div>
        <span class="powerup-marker__label">${template.label}</span>
      `,
      iconSize: [40, 48],
      iconAnchor: [20, 34]
    });
  }

  function addPlayerProjectile({ lat, lng, dx, dy, damage = 1, color = 'red', fillColor = 'red', radius = 4, lifetime = 100, fillOpacity = 0.9, seeking = false, target = null, turnRate = 0, initialSpeed = 0 }) {
    if (seeking) {
      const headingRad = carHeading * Math.PI / 180;
      dx = Math.sin(headingRad) * initialSpeed;
      dy = Math.cos(headingRad) * initialSpeed;
    }

    const projectile = {
      lat,
      lng,
      dx,
      dy,
      damage,
      lifetime,
      marker: L.circleMarker([lat, lng], {
        seeking,
        target,
        turnRate,
        radius,
        color,
        fillColor,
        fillOpacity,
        weight: 1
      }).addTo(map)
    };
    projectiles.push(projectile);
    return projectile;
  }

  function spawnPowerUpAt(lat, lng, typeKey) { // No change needed here, this is for powerup markers, not projectiles
    const template = POWERUP_TYPES[typeKey];
    if (!template) return null;
    const icon = createPowerUpIcon(template);
    const marker = L.marker([lat, lng], {
      icon,
      interactive: false
    }).addTo(map);
    const powerUp = {
      type: typeKey,
      template,
      lat,
      lng,
      marker
    };
    powerUps.push(powerUp);
    return powerUp;
  }

  function clearPowerUps() {
    for (let i = powerUps.length - 1; i >= 0; i--) {
      map.removeLayer(powerUps[i].marker);
    }
    powerUps.length = 0;
  }

function maybeSpawnPowerUp(lat, lng) {
    const POWERUP_DROP_CHANCE = 0.15;
    if (Math.random() < POWERUP_DROP_CHANCE) {
        const spawnable = Object.entries(POWERUP_TYPES).filter(([, v]) => v.spawnable !== false);
        if (spawnable.length === 0) return;

        const totalRarity = spawnable.reduce((sum, [, v]) => sum + (v.rarity ?? 1), 0);
        let randomPick = Math.random() * totalRarity;

        for (const [key, value] of spawnable) {
            randomPick -= (value.rarity ?? 1);
            if (randomPick <= 0) {
                spawnPowerUpAt(lat, lng, key);
                return;
            }
        }
        // Fallback to the last one, just in case of floating point inaccuracies
        const [lastKey] = spawnable[spawnable.length - 1];
        spawnPowerUpAt(lat, lng, lastKey);
    }
}

  function applyPowerUp(typeKey) {
    const template = POWERUP_TYPES[typeKey] ?? POWERUP_TYPES[DEFAULT_WEAPON];
    currentWeapon = template.weapon ?? DEFAULT_WEAPON;
    if (template.duration && template.duration > 0) {
      weaponExpireTime = Date.now() + template.duration;
    } else {
      weaponExpireTime = 0;
    }
    updateWeaponDisplay();
    if (template && template.label) {
      showTemporaryMessage(`Weapon upgraded: ${template.label}`, 3000);
    }
  }

  function updateWeaponDisplay() {
    const weaponEl = document.getElementById('weaponDisplay');
    if (!weaponEl) return;
    const template = POWERUP_TYPES[currentWeapon] ?? POWERUP_TYPES[DEFAULT_WEAPON];
    let text = `Weapon: ${template?.label ?? 'Wide Spray'}`;
    if (weaponExpireTime && weaponExpireTime > Date.now()) {
      const seconds = Math.ceil((weaponExpireTime - Date.now()) / 1000);
      text += ` (${seconds}s)`;
    }
    weaponEl.textContent = text;
  }

  function checkPowerUpPickup(playerLat, playerLng) {
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const powerUp = powerUps[i];
      if (Math.hypot(powerUp.lat - playerLat, powerUp.lng - playerLng) < 0.003) {
        map.removeLayer(powerUp.marker);
        powerUps.splice(i, 1);
        applyPowerUp(powerUp.type);
      }
    }
  }

  function handleWeaponExpiry(now) {
    if (currentWeapon === DEFAULT_WEAPON) return;
    if (!weaponExpireTime || now <= weaponExpireTime) return;
    currentWeapon = DEFAULT_WEAPON;
    weaponExpireTime = 0;
    updateWeaponDisplay();
    showTemporaryMessage('Weapon reverted to Wide Spray.', 3000);
  }

function triggerEnemyExplosion(enemy) {
    const template = enemy.template || ENEMY_TEMPLATES.gunner;
    const color = template.explosionColor || template.glowColor || '#ff8a65';
    
    // Main explosion (larger and brighter)
    const explosion = L.circleMarker([enemy.lat, enemy.lng], {
      radius: 12,
      color,
      fillColor: color,
      fillOpacity: 0.95,
      weight: 3,
      className: 'enemy-explosion'
    }).addTo(map);

    // Secondary shockwave ring
    const shockwave = L.circleMarker([enemy.lat, enemy.lng], {
      radius: 8,
      color: '#ffffff',
      fillColor: color,
      fillOpacity: 0.6,
      weight: 2,
      className: 'enemy-explosion'
    }).addTo(map);

    let step = 0;
    const maxSteps = 20;
    const interval = setInterval(() => {
      step += 1;
      const progress = step / maxSteps;
      
      // Main explosion grows larger
      explosion.setStyle({
        radius: 12 + progress * 32,
        opacity: 1.0 * (1 - progress),
        fillOpacity: 0.85 * (1 - progress)
      });
      
      // Shockwave expands faster
      shockwave.setStyle({
        radius: 8 + progress * 48,
        opacity: 0.7 * (1 - progress * progress),
        fillOpacity: 0.4 * (1 - progress * progress)
      });
      
      if (step >= maxSteps) {
        clearInterval(interval);
        map.removeLayer(explosion);
        map.removeLayer(shockwave);
      }
    }, 25);
  }

  function clearExistingEnemies() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      removeEnemy(enemies[i]);
    }
    clearEnemyBombs();
  }

  function spawnStageEnemies() {
    clearExistingEnemies();

    if (!routeStart || !routeDestination) return;
    const count = getStageEnemyCount(difficultyLevel);
    const availableTypes = getStageEnemyTypes(difficultyLevel);

    const typePool = [...availableTypes];
    while (typePool.length < count) {
      typePool.push(availableTypes[Math.floor(Math.random() * availableTypes.length)]);
    }
    shuffleArray(typePool);

    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1);
      const basePoint = interpolateRoutePoint(t);
      const jitterLat = (Math.random() - 0.5) * ENEMY_JITTER;
      const jitterLng = (Math.random() - 0.5) * ENEMY_JITTER;
      const typeKey = typePool[i];
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
    const requiredPercent = Math.min(0.7, 0.35 + (difficultyLevel - 1) * 0.05); // Start at 35%, increase by 5% per level, cap at 70%
    hostilesRequiredThisStage = totalHostilesThisStage
      ? Math.max(1, Math.ceil(totalHostilesThisStage * requiredPercent))
      : 0;
    hostilesDestroyedThisStage = 0;
    updateHostilesDisplay();
    clearPowerUps();
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

  async function advanceToNextCity() {
    if (legTransitionInProgress) return;
    legTransitionInProgress = true;
    gamePaused = true;

    // Spin-in animation
    const playerPos = playerMarker.getLatLng();
    const destPos = routeDestination;
    const duration = 1500; // ms
    const startTime = Date.now();

    const spinAnimation = () => {
      const now = Date.now();
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const easeProgress = 0.5 - 0.5 * Math.cos(progress * Math.PI);

      const newLat = playerPos.lat + (destPos.lat - playerPos.lat) * easeProgress;
      const newLng = playerPos.lng + (destPos.lng - playerPos.lng) * easeProgress;
      const newHeading = carHeading + 1080 * easeProgress; // 3 full spins

      playerMarker.setLatLng([newLat, newLng]);
      const iconElement = playerMarker.getElement().querySelector('img');
      if (iconElement) {
        iconElement.style.transform = `rotate(${newHeading}deg)`;
      }

      if (progress < 1) {
        requestAnimationFrame(spinAnimation);
      } else {
        // Animation finished, prepare for next level
        playerMarker.setLatLng([destPos.lat, destPos.lng]);
        GameState.player.lat = destPos.lat;
        GameState.player.lng = destPos.lng;
        carHeading = 0;
        const iconElement = playerMarker.getElement().querySelector('img');
        if (iconElement) iconElement.style.transform = `rotate(0deg)`;
        
        clearExistingEnemies();
        resetProjectiles();

        visitedCityIndices.add(currentDestIdx);
        const nextDestIdx = findNextDestinationIndex(currentDestIdx);

        if (nextDestIdx === null) {
          prepareOverlay({ message: 'All cities secured! Mission Accomplished!', showButton: false });
          return;
        }

        prepareOverlay({ message: `Stage ${difficultyLevel} Complete!`, showButton: true });
        const startButton = overlayElements.button;
        startButton.textContent = 'Start Next Level';
        
        // Use a fresh event listener to avoid stacking them
        const oldButton = startButton.cloneNode(true);
        startButton.parentNode.replaceChild(oldButton, startButton);
        overlayElements.button = oldButton;

        const startNext = () => {
          hideOverlay();
          difficultyLevel += 1;
          const enemyCount = startLeg({ startIdx: currentDestIdx, destIdx: nextDestIdx, resetPlayerPosition: false, healPlayer: true });
          const nextRequirement = hostilesRequiredThisStage || enemyCount;
          setMissionBaseMessage(`Stage ${difficultyLevel}: Neutralize ${nextRequirement} of ${enemyCount} hostiles between ${getCityName(currentStartIdx)} and ${getCityName(currentDestIdx)}.`);
          stageCleared = false;
          gamePaused = false;
          requestAnimationFrame(updateCarPosition);
          legTransitionInProgress = false;
        };
        overlayElements.button.addEventListener('click', startNext, { once: true });
      }
    };

    requestAnimationFrame(spinAnimation);
  }

  function checkStageCleared() {
    if (stageCleared) return;
    const requirement = hostilesRequiredThisStage || totalHostilesThisStage;
    const requirementMet = requirement === 0 || hostilesDestroyedThisStage >= requirement;
    if (!requirementMet && enemies.length > 0) return;
    stageCleared = true;
    const destName = getCityName(currentDestIdx);
    const displayed = requirement ? Math.min(hostilesDestroyedThisStage, requirement) : hostilesDestroyedThisStage;
    const totalText = totalHostilesThisStage ? ` (Total detected: ${totalHostilesThisStage})` : '';
    setMissionBaseMessage(`Route clear! Proceed to ${destName}. Hostiles neutralized: ${displayed}/${requirement || displayed}.${totalText}`);
  }

  document.getElementById("closeInfoPanel").addEventListener("click", hideInfoPanel);

})();
