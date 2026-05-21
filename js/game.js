const canvas = document.querySelector('#radar');
const ctx = canvas.getContext('2d');

const ui = {
  startBtn: document.querySelector('#startBtn'),
  pauseBtn: document.querySelector('#pauseBtn'),
  resetBtn: document.querySelector('#resetBtn'),
  score: document.querySelector('#score'),
  safety: document.querySelector('#safety'),
  clock: document.querySelector('#clock'),
  scenarioSelect: document.querySelector('#scenarioSelect'),
  trafficSelect: document.querySelector('#trafficSelect'),
  speedSelect: document.querySelector('#speedSelect'),
  selectedBadge: document.querySelector('#selectedBadge'),
  selectedDetails: document.querySelector('#selectedDetails'),
  directSelect: document.querySelector('#directSelect'),
  directBtn: document.querySelector('#directBtn'),
  landBtn: document.querySelector('#landBtn'),
  handoffBtn: document.querySelector('#handoffBtn'),
  takeoffBtn: document.querySelector('#takeoffBtn'),
  queueList: document.querySelector('#queueList'),
  log: document.querySelector('#log'),
  clearLogBtn: document.querySelector('#clearLogBtn'),
  toast: document.querySelector('#toast'),
};

const DEG = Math.PI / 180;
const STORAGE_KEY = 'skyvector-atc-last-scenario';
const TRAFFIC_PROFILE_KEY = 'skyvector-atc-traffic-profile';


const trafficProfiles = {
  training: { label: '训练 40%', scale: 0.40, spacing: 1.75, groundHoldBonus: 70, minSeparationAdjust: -0.7 },
  easy: { label: '轻松 60%', scale: 0.60, spacing: 1.45, groundHoldBonus: 45, minSeparationAdjust: -0.4 },
  normal: { label: '标准 80%', scale: 0.80, spacing: 1.20, groundHoldBonus: 20, minSeparationAdjust: -0.2 },
  full: { label: '完整 100%', scale: 1.00, spacing: 1.00, groundHoldBonus: 0, minSeparationAdjust: 0 },
};

const fallbackPayload = {
  version: 1,
  scenarios: [
    {
      id: 'fallback', name: '备用训练场景', difficulty: 1,
      airspace: {
        name: '珠江终端管制区', radiusNm: 42, minSeparationNm: 5, handoffToleranceDeg: 28, groundHoldLimitSec: 80,
        gates: [
          { id: 'NORTH', x: 0, y: 0.93, bearing: 0, label: '北门' },
          { id: 'EAST', x: 0.93, y: 0, bearing: 90, label: '东门' },
          { id: 'SOUTH', x: 0, y: -0.93, bearing: 180, label: '南门' },
          { id: 'WEST', x: -0.93, y: 0, bearing: 270, label: '西门' },
        ],
        fixes: [
          { id: 'ALPHA', x: -0.48, y: 0.52, label: 'ALPHA' },
          { id: 'BRAVO', x: 0.42, y: 0.58, label: 'BRAVO' },
          { id: 'FINAL04', x: -0.28, y: -0.34, label: 'F04' },
          { id: 'FINAL22', x: 0.28, y: 0.34, label: 'F22' },
        ],
        runways: [
          { id: 'RWY 04', heading: 40, x: 0, y: 0, length: 0.46 },
          { id: 'RWY 22', heading: 220, x: 0, y: 0, length: 0.46 },
        ],
        weather: [{ id: 'WX1', x: -0.12, y: 0.25, r: 0.12, severity: 'moderate' }],
      },
      traffic: [
        { id: 'A1', callsign: 'CPA812', kind: 'arrival', type: 'A320', spawnAt: 4, spawnGate: 'NORTH', x: 0, y: 0.93, heading: 180, altitude: 7000, speed: 240, targetRunway: 'RWY 04', targetAltitude: 1800 },
        { id: 'A2', callsign: 'CES462', kind: 'arrival', type: 'B738', spawnAt: 24, spawnGate: 'WEST', x: -0.93, y: 0, heading: 90, altitude: 8000, speed: 250, targetRunway: 'RWY 22', targetAltitude: 1800 },
        { id: 'D1', callsign: 'CSN305', kind: 'departure', type: 'A321', queueAt: 0, spawnAt: 0, status: 'queued', targetExit: 'EAST', runway: 'RWY 04', heading: 40, altitude: 0, speed: 0, targetAltitude: 6000 },
        { id: 'D2', callsign: 'CCA908', kind: 'departure', type: 'C919', queueAt: 20, spawnAt: 20, status: 'queued', targetExit: 'SOUTH', runway: 'RWY 22', heading: 220, altitude: 0, speed: 0, targetAltitude: 5000 },
      ],
    },
  ],
};

const state = {
  scenarios: [],
  scenario: null,
  trafficEvents: [],
  active: [],
  queue: [],
  spawned: new Set(),
  time: 0,
  running: false,
  paused: false,
  gameOver: false,
  speed: 1,
  trafficProfile: localStorage.getItem(TRAFFIC_PROFILE_KEY) || 'training',
  selectedId: null,
  score: 0,
  safety: 100,
  lastFrame: performance.now(),
  drag: null,
  logCount: 0,
};

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function normHeading(deg) { return ((deg % 360) + 360) % 360; }
function headingDiff(a, b) {
  const d = Math.abs(normHeading(a) - normHeading(b)) % 360;
  return d > 180 ? 360 - d : d;
}
function degToVector(heading) {
  const r = heading * DEG;
  return { x: Math.sin(r), y: Math.cos(r) };
}
function bearingBetween(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return normHeading(Math.atan2(dx, dy) / DEG);
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function getGate(id) { return state.scenario.airspace.gates.find(g => g.id === id); }
function getRunway(id) { return state.scenario.airspace.runways.find(r => r.id === id); }
function selectedAircraft() { return state.active.find(a => a.id === state.selectedId) || null; }

function log(message, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `<span class="time">${formatTime(state.time)}</span>${message}`;
  ui.log.prepend(entry);
  state.logCount += 1;
  while (ui.log.children.length > 80) ui.log.lastChild.remove();
}

function toast(message, level = 'ok') {
  ui.toast.textContent = message;
  ui.toast.className = `toast show ${level}`;
  clearTimeout(ui.toast._timer);
  ui.toast._timer = setTimeout(() => ui.toast.classList.remove('show'), 2400);
}

function worldToScreen(point) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width, rect.height) * 0.43;
  return { x: rect.width / 2 + point.x * scale, y: rect.height / 2 - point.y * scale, scale };
}
function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const scale = Math.min(rect.width, rect.height) * 0.43;
  return { x: (x - rect.width / 2) / scale, y: -(y - rect.height / 2) / scale };
}

function resizeCanvasToDisplaySize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

async function loadScenarios() {
  try {
    const response = await fetch('data/scenarios.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.scenarios = payload.scenarios || fallbackPayload.scenarios;
  } catch (error) {
    state.scenarios = fallbackPayload.scenarios;
    log('无法读取 data/scenarios.json，已载入内置备用场景。建议用本地服务器打开页面。', 'warn');
  }
  populateScenarioSelect();
  const last = localStorage.getItem(STORAGE_KEY);
  const initial = state.scenarios.find(s => s.id === last) || state.scenarios[0];
  loadScenario(initial.id);
}

function populateScenarioSelect() {
  ui.scenarioSelect.innerHTML = state.scenarios.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
}

function activeTrafficProfile() {
  return trafficProfiles[state.trafficProfile] || trafficProfiles.training;
}

function takeByProfile(items, profile) {
  if (profile.scale >= 0.999) return items.map(item => ({ ...item }));
  const targetCount = Math.max(1, Math.ceil(items.length * profile.scale));
  return items
    .slice()
    .sort((a, b) => (a.spawnAt ?? a.queueAt ?? 0) - (b.spawnAt ?? b.queueAt ?? 0))
    .slice(0, targetCount)
    .map(item => ({ ...item }));
}

function buildTrafficEvents(scenario) {
  const profile = activeTrafficProfile();
  const arrivals = takeByProfile(scenario.traffic.filter(t => t.kind === 'arrival'), profile);
  const departures = takeByProfile(scenario.traffic.filter(t => t.kind === 'departure'), profile);
  return [...arrivals, ...departures]
    .map(item => {
      const copy = { ...item };
      if (typeof copy.spawnAt === 'number') copy.spawnAt = Math.round(copy.spawnAt * profile.spacing);
      if (typeof copy.queueAt === 'number') copy.queueAt = Math.round(copy.queueAt * profile.spacing);
      return copy;
    })
    .sort((a, b) => (a.spawnAt ?? a.queueAt ?? 0) - (b.spawnAt ?? b.queueAt ?? 0));
}

function applyTrafficProfileToRules(scenario) {
  const profile = activeTrafficProfile();
  scenario.airspace.groundHoldLimitSec = Math.round((scenario.airspace.groundHoldLimitSec ?? 75) + profile.groundHoldBonus);
  scenario.airspace.minSeparationNm = Math.max(4.0, Number(((scenario.airspace.minSeparationNm ?? 5) + profile.minSeparationAdjust).toFixed(1)));
}

function loadScenario(id) {
  const scenario = state.scenarios.find(s => s.id === id) || state.scenarios[0];
  state.scenario = structuredClone(scenario);
  applyTrafficProfileToRules(state.scenario);
  localStorage.setItem(STORAGE_KEY, scenario.id);
  ui.scenarioSelect.value = scenario.id;
  if (ui.trafficSelect) ui.trafficSelect.value = state.trafficProfile;
  state.trafficEvents = buildTrafficEvents(state.scenario);
  state.active = [];
  state.queue = [];
  state.spawned = new Set();
  state.time = 0;
  state.running = false;
  state.paused = false;
  state.gameOver = false;
  state.selectedId = null;
  state.score = 0;
  state.safety = 100;
  state.drag = null;
  ui.log.innerHTML = '';
  const profile = activeTrafficProfile();
  const arrivals = state.trafficEvents.filter(t => t.kind === 'arrival').length;
  const departures = state.trafficEvents.filter(t => t.kind === 'departure').length;
  log(`载入场景：${scenario.name} · ${profile.label}。本局 ${arrivals} 架进近 / ${departures} 架离场，最低间隔 ${state.scenario.airspace.minSeparationNm} NM。`, 'ok');
  log('提示：拖拽飞机即可给航向；进近飞机点“准许落地”后会自动截获五边、调速、下降并落地。');
  updateDirectOptions();
  updateUI();
}

function updateDirectOptions() {
  const items = [
    ...state.scenario.airspace.gates.map(g => ({ id: g.id, label: `${g.label || g.id} · 交接门` })),
    ...state.scenario.airspace.fixes.map(f => ({ id: f.id, label: `${f.label || f.id} · 航路点` })),
  ];
  ui.directSelect.innerHTML = items.map(item => `<option value="${item.id}">${item.label}</option>`).join('');
}

function spawnArrival(event) {
  const aircraft = {
    ...event,
    state: 'arrival',
    targetHeading: event.heading,
    assignedAltitude: event.altitude,
    targetSpeed: event.speed,
    clearedLanding: false,
    conflict: false,
    warnings: new Set(),
    trail: [],
  };
  state.active.push(aircraft);
  log(`${aircraft.callsign} 进入管制区，${event.spawnGate} 方向，${aircraft.altitude} 英尺，目标 ${aircraft.targetRunway}。`);
}

function enqueueDeparture(event) {
  state.queue.push({ ...event, enqueuedAt: state.time });
  log(`${event.callsign} 等待离场，跑道 ${event.runway}，目标 ${event.targetExit}，初始高度 ${event.targetAltitude}。`);
}

function processTrafficEvents() {
  for (const event of state.trafficEvents) {
    if (state.spawned.has(event.id)) continue;
    const when = event.kind === 'departure' ? (event.queueAt ?? event.spawnAt ?? 0) : (event.spawnAt ?? 0);
    if (state.time >= when) {
      if (event.kind === 'arrival') spawnArrival(event);
      if (event.kind === 'departure') enqueueDeparture(event);
      state.spawned.add(event.id);
    }
  }
}

function runwayStart(runwayId, headingOverride = null) {
  const runway = getRunway(runwayId);
  const heading = headingOverride ?? runway.heading;
  const v = degToVector(heading);
  return { x: runway.x - v.x * runway.length * 0.48, y: runway.y - v.y * runway.length * 0.48 };
}

function runwayLandingGeometry(runway) {
  const v = degToVector(runway.heading);
  const threshold = { x: runway.x - v.x * runway.length * 0.5, y: runway.y - v.y * runway.length * 0.5 };
  const touchdown = { x: runway.x - v.x * runway.length * 0.12, y: runway.y - v.y * runway.length * 0.12 };
  const finalFix = { x: threshold.x - v.x * 0.34, y: threshold.y - v.y * 0.34 };
  const outerFix = { x: threshold.x - v.x * 0.56, y: threshold.y - v.y * 0.56 };
  return { v, threshold, touchdown, finalFix, outerFix };
}

function signedCrossTrack(point, origin, direction) {
  const rel = { x: point.x - origin.x, y: point.y - origin.y };
  return direction.x * rel.y - direction.y * rel.x;
}

function alongTrack(point, origin, direction) {
  const rel = { x: point.x - origin.x, y: point.y - origin.y };
  return rel.x * direction.x + rel.y * direction.y;
}

function updateAutoLanding(aircraft) {
  if (aircraft.kind !== 'arrival' || !aircraft.clearedLanding || !aircraft.autoLand) return;
  const runway = getRunway(aircraft.targetRunway);
  if (!runway) return;

  const geo = runwayLandingGeometry(runway);
  const radiusNm = state.scenario.airspace.radiusNm;
  const cross = signedCrossTrack(aircraft, geo.threshold, geo.v);
  const crossNm = Math.abs(cross) * radiusNm;
  const along = alongTrack(aircraft, geo.threshold, geo.v);
  const distanceToThresholdNm = Math.max(0, -along * radiusNm);
  const distanceToFinalFix = distance(aircraft, geo.finalFix);
  const inFinalCorridor = crossNm < 4.6 && along < 0.03 && headingDiff(aircraft.heading, runway.heading) < 75;

  if (aircraft.autoLand.phase === 'vector' && (distanceToFinalFix < 0.11 || inFinalCorridor)) {
    aircraft.autoLand.phase = 'capture';
    log(`${aircraft.callsign} 自动截获 ${runway.id} 五边。`, 'ok');
  }
  if (aircraft.autoLand.phase === 'capture' && (crossNm < 2.8 || distanceToFinalFix < 0.05)) {
    aircraft.autoLand.phase = 'final';
    log(`${aircraft.callsign} 建立 ${runway.id} 最后进近，自动配平下滑。`, 'ok');
  }

  if (aircraft.autoLand.phase === 'vector') {
    const target = distance(aircraft, geo.finalFix) > 0.08 ? geo.finalFix : geo.threshold;
    aircraft.targetHeading = bearingBetween(aircraft, target);
    aircraft.targetSpeed = 215;
    aircraft.assignedAltitude = clamp(2300 + Math.min(distance(aircraft, geo.finalFix) * radiusNm, 12) * 90, 2400, 3600);
    aircraft.autoLand.guidance = `引导至 ${runway.id} 截获点`;
    return;
  }

  const correction = clamp(cross * 120, -28, 28);
  aircraft.targetHeading = normHeading(runway.heading + correction);

  if (aircraft.autoLand.phase === 'capture') {
    aircraft.targetSpeed = 190;
    aircraft.assignedAltitude = clamp(1800 + distanceToThresholdNm * 115, 1700, 3200);
    aircraft.autoLand.guidance = `截获航向 ${Math.round(aircraft.targetHeading).toString().padStart(3, '0')}`;
    return;
  }

  aircraft.targetSpeed = distanceToThresholdNm < 4 ? 158 : 170;
  aircraft.assignedAltitude = clamp(450 + distanceToThresholdNm * 310, 160, 2800);
  aircraft.autoLand.guidance = `自动下滑 ${Math.round(distanceToThresholdNm)}NM`;
}

function clearTakeoff() {
  if (!state.running || state.paused || state.gameOver) return toast('先开始模拟。', 'warn');
  const item = state.queue.shift();
  if (!item) return toast('当前没有等待起飞的飞机。', 'warn');
  const runway = getRunway(item.runway);
  const start = runwayStart(item.runway, runway.heading);
  const aircraft = {
    ...item,
    x: start.x,
    y: start.y,
    state: 'departure',
    heading: runway.heading,
    targetHeading: runway.heading,
    altitude: 250,
    assignedAltitude: item.targetAltitude,
    speed: 145,
    targetSpeed: 250,
    clearedDeparture: true,
    conflict: false,
    warnings: new Set(),
    trail: [],
  };
  state.active.push(aircraft);
  state.selectedId = aircraft.id;
  log(`${aircraft.callsign} 准许起飞 ${aircraft.runway}，离场 ${aircraft.targetExit}，爬升 ${aircraft.targetAltitude} 英尺。`, 'ok');
  toast(`${aircraft.callsign} 起飞，指挥至 ${aircraft.targetExit}`, 'ok');
  updateUI();
}

function commandHeading(aircraft, heading, source = '航向') {
  aircraft.targetHeading = normHeading(heading);
  log(`${aircraft.callsign} ${source} ${Math.round(aircraft.targetHeading).toString().padStart(3, '0')}。`);
}

function commandDirect(id) {
  const aircraft = selectedAircraft();
  if (!aircraft) return toast('请选择飞机。', 'warn');
  const target = [...state.scenario.airspace.gates, ...state.scenario.airspace.fixes].find(p => p.id === id);
  if (!target) return;
  const hdg = bearingBetween(aircraft, target);
  aircraft.targetHeading = hdg;
  aircraft.directTo = id;
  log(`${aircraft.callsign} 直飞 ${target.label || target.id}，航向 ${Math.round(hdg).toString().padStart(3, '0')}。`);
}

function commandAltitude(delta) {
  const aircraft = selectedAircraft();
  if (!aircraft) return toast('请选择飞机。', 'warn');
  const minAlt = aircraft.kind === 'departure' ? 3000 : 1200;
  aircraft.assignedAltitude = clamp((aircraft.assignedAltitude ?? aircraft.altitude) + delta, minAlt, 12000);
  log(`${aircraft.callsign} ${delta > 0 ? '爬升' : '下降'}至 ${aircraft.assignedAltitude} 英尺。`);
}

function commandSpeed(delta) {
  const aircraft = selectedAircraft();
  if (!aircraft) return toast('请选择飞机。', 'warn');
  aircraft.targetSpeed = clamp((aircraft.targetSpeed ?? aircraft.speed) + delta, 150, 330);
  log(`${aircraft.callsign} 调速 ${aircraft.targetSpeed} 节。`);
}

function clearLanding() {
  const aircraft = selectedAircraft();
  if (!aircraft) return toast('请选择进近飞机。', 'warn');
  if (aircraft.kind !== 'arrival') return toast('只有进近飞机可以准许落地。', 'warn');
  aircraft.clearedLanding = true;
  aircraft.autoLand = { phase: 'vector', armedAt: state.time, guidance: '自动进近已接通' };
  aircraft.warnings.delete('unstable');
  const runway = getRunway(aircraft.targetRunway);
  if (runway) {
    const geo = runwayLandingGeometry(runway);
    aircraft.targetHeading = bearingBetween(aircraft, geo.finalFix);
  }
  aircraft.assignedAltitude = Math.min(aircraft.altitude, 3600);
  aircraft.targetSpeed = 215;
  log(`${aircraft.callsign} 准许落地 ${aircraft.targetRunway}，自动进近接通：系统将规划截获点、航向、速度和下滑高度。`, 'ok');
  toast(`${aircraft.callsign} 自动落地程序接通`, 'ok');
  updateUI();
}

function manualHandoff() {
  const aircraft = selectedAircraft();
  if (!aircraft) return toast('请选择离场飞机。', 'warn');
  if (aircraft.kind !== 'departure') return toast('只有离场飞机需要雷达移交。', 'warn');
  if (isDepartureHandoffValid(aircraft, 0.82)) {
    completeAircraft(aircraft, `${aircraft.callsign} 已在 ${aircraft.targetExit} 附近雷达移交。`, 75);
  } else {
    const gate = getGate(aircraft.targetExit);
    const outBearing = bearingBetween({ x: 0, y: 0 }, aircraft);
    const diff = headingDiff(outBearing, gate.bearing);
    log(`${aircraft.callsign} 尚未满足移交：距中心 ${(distance(aircraft, {x:0,y:0}) * state.scenario.airspace.radiusNm).toFixed(1)} NM，出口偏差 ${Math.round(diff)}°。`, 'warn');
    toast('还未到指定交接门，继续指挥。', 'warn');
  }
}

function stepAircraft(aircraft, dt) {
  aircraft.conflict = false;
  updateAutoLanding(aircraft);
  const turnRate = aircraft.autoLand ? 4.8 : 3.2;
  const diff = ((aircraft.targetHeading - aircraft.heading + 540) % 360) - 180;
  aircraft.heading = normHeading(aircraft.heading + clamp(diff, -turnRate * dt, turnRate * dt));

  const accel = aircraft.autoLand ? 7.5 : aircraft.kind === 'departure' ? 7 : 5;
  const speedDiff = (aircraft.targetSpeed ?? aircraft.speed) - aircraft.speed;
  aircraft.speed = clamp(aircraft.speed + clamp(speedDiff, -accel * dt, accel * dt), 120, 340);

  const altTarget = aircraft.assignedAltitude ?? aircraft.altitude;
  const maxClimb = aircraft.kind === 'departure' ? 42 : 24;
  const maxDescent = aircraft.autoLand ? 48 : aircraft.kind === 'arrival' ? 34 : 20;
  const altDiff = altTarget - aircraft.altitude;
  aircraft.altitude += clamp(altDiff, -maxDescent * dt, maxClimb * dt);
  aircraft.altitude = Math.max(0, aircraft.altitude);

  const radiusNm = state.scenario.airspace.radiusNm;
  const worldPerSecond = (aircraft.speed / radiusNm / 3600) * 1.65;
  const v = degToVector(aircraft.heading);
  aircraft.x += v.x * worldPerSecond * dt;
  aircraft.y += v.y * worldPerSecond * dt;

  aircraft.trail.push({ x: aircraft.x, y: aircraft.y });
  if (aircraft.trail.length > 80) aircraft.trail.shift();
}

function isDepartureHandoffValid(aircraft, minRadius = 1.0) {
  const gate = getGate(aircraft.targetExit);
  if (!gate) return false;
  const range = distance(aircraft, { x: 0, y: 0 });
  const outBearing = bearingBetween({ x: 0, y: 0 }, aircraft);
  const tolerance = state.scenario.airspace.handoffToleranceDeg ?? 28;
  return range >= minRadius && headingDiff(outBearing, gate.bearing) <= tolerance && aircraft.altitude >= aircraft.targetAltitude - 500;
}

function checkAirspaceExit(aircraft) {
  const range = distance(aircraft, { x: 0, y: 0 });
  if (range <= 1.03) return;
  if (aircraft.kind === 'departure') {
    if (isDepartureHandoffValid(aircraft, 0.98)) {
      completeAircraft(aircraft, `${aircraft.callsign} 经 ${aircraft.targetExit} 离开管制区，雷达移交成功。`, 100);
    } else {
      fail(`${aircraft.callsign} 离场偏离指定交接门，未能安全移交。`);
    }
  } else {
    fail(`${aircraft.callsign} 进近飞机飞出管制区。`);
  }
}

function checkLanding(aircraft) {
  if (aircraft.kind !== 'arrival' || !aircraft.clearedLanding) return;
  const runway = getRunway(aircraft.targetRunway);
  const geo = runwayLandingGeometry(runway);
  const touchdownRange = distance(aircraft, geo.touchdown);
  const centerRange = distance(aircraft, runway);
  const trackErr = headingDiff(aircraft.heading, runway.heading);
  const speedOk = aircraft.speed <= (aircraft.autoLand ? 220 : 205);
  const altOk = aircraft.altitude <= (aircraft.autoLand ? 2600 : 2300);

  if (aircraft.autoLand && touchdownRange < 0.095 && trackErr < 48 && speedOk && altOk) {
    completeAircraft(aircraft, `${aircraft.callsign} ${aircraft.targetRunway} 自动落地，脱离跑道。`, 135);
  } else if (!aircraft.autoLand && centerRange < 0.085 && trackErr < 36 && speedOk && altOk) {
    completeAircraft(aircraft, `${aircraft.callsign} ${aircraft.targetRunway} 落地，脱离跑道。`, 120);
  } else if (!aircraft.autoLand && centerRange < 0.16 && !aircraft.warnings.has('unstable')) {
    aircraft.warnings.add('unstable');
    if (!speedOk || !altOk || trackErr >= 45) {
      log(`${aircraft.callsign} 进近不稳定：航迹/速度/高度需继续调整。`, 'warn');
      toast(`${aircraft.callsign} 进近不稳定`, 'warn');
    }
  }
}

function checkWeather(aircraft) {
  for (const cell of state.scenario.airspace.weather || []) {
    const wxDist = distance(aircraft, cell);
    if (wxDist < cell.r) {
      const key = `wx-${cell.id}`;
      if (!aircraft.warnings.has(key)) {
        aircraft.warnings.add(key);
        log(`${aircraft.callsign} 穿越 ${cell.id} ${cell.severity} 天气，建议绕飞。`, cell.severity === 'heavy' ? 'warn' : 'info');
      }
      if (cell.severity === 'heavy') state.safety = Math.max(0, state.safety - 0.01);
    }
  }
}

function checkSeparation(dt) {
  const minNm = state.scenario.airspace.minSeparationNm;
  const radiusNm = state.scenario.airspace.radiusNm;
  for (let i = 0; i < state.active.length; i++) {
    for (let j = i + 1; j < state.active.length; j++) {
      const a = state.active[i];
      const b = state.active[j];
      const dNm = distance(a, b) * radiusNm;
      const alt = Math.abs(a.altitude - b.altitude);
      if (dNm < minNm && alt < 1000) {
        a.conflict = true;
        b.conflict = true;
        state.safety = Math.max(0, state.safety - 0.12 * dt);
        const pairKey = `conflict-${b.id}`;
        if (!a.warnings.has(pairKey)) {
          a.warnings.add(pairKey);
          log(`冲突告警：${a.callsign} 与 ${b.callsign} 间隔 ${dNm.toFixed(1)} NM / ${Math.round(alt)} ft。`, 'warn');
        }
        if (dNm < minNm * 0.62 && alt < 500) {
          fail(`严重冲突：${a.callsign} 与 ${b.callsign} 间隔不足。`);
          return;
        }
      }
    }
  }
}

function checkGroundQueue() {
  const limit = state.scenario.airspace.groundHoldLimitSec ?? 75;
  for (const item of state.queue) {
    if (state.time - item.enqueuedAt > limit) {
      fail(`${item.callsign} 地面等待超过 ${limit} 秒，流控失败。`);
      return;
    }
  }
}

function completeAircraft(aircraft, message, points) {
  const idx = state.active.findIndex(a => a.id === aircraft.id);
  if (idx >= 0) state.active.splice(idx, 1);
  if (state.selectedId === aircraft.id) state.selectedId = null;
  state.score += points;
  state.safety = Math.min(100, state.safety + 1.5);
  log(message, 'ok');
  toast(message, 'ok');
  updateUI();
}

function fail(message) {
  if (state.gameOver) return;
  state.gameOver = true;
  state.running = false;
  state.paused = false;
  log(`模拟结束：${message}`, 'fail');
  toast(message, 'fail');
  updateUI();
}

function maybeScenarioComplete() {
  if (!state.running || state.gameOver) return;
  const allSpawned = state.spawned.size >= state.trafficEvents.length;
  if (allSpawned && state.active.length === 0 && state.queue.length === 0) {
    state.running = false;
    log(`场景完成。最终得分 ${state.score}，安全指数 ${Math.round(state.safety)}%。`, 'ok');
    toast('场景完成，干得漂亮！', 'ok');
  }
}

function update(dt) {
  if (!state.running || state.paused || state.gameOver) return;
  state.time += dt;
  processTrafficEvents();
  for (const aircraft of [...state.active]) {
    stepAircraft(aircraft, dt);
    checkWeather(aircraft);
    checkLanding(aircraft);
    checkAirspaceExit(aircraft);
    if (state.gameOver) return;
  }
  checkSeparation(dt);
  checkGroundQueue();
  maybeScenarioComplete();
  updateUI();
}

function drawBackground(rect) {
  ctx.clearRect(0, 0, rect.width, rect.height);
  const c = worldToScreen({ x: 0, y: 0 });
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.strokeStyle = 'rgba(83, 228, 255, 0.18)';
  ctx.lineWidth = 1;
  for (const r of [0.25, 0.5, 0.75, 1.0]) {
    ctx.beginPath();
    ctx.arc(0, 0, r * c.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let deg = 0; deg < 360; deg += 30) {
    const v = degToVector(deg);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(v.x * c.scale, -v.y * c.scale);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(83, 228, 255, 0.42)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, c.scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(238, 247, 255, 0.72)';
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText(state.scenario.airspace.name, 22, rect.height - 24);
}

function drawWeather() {
  for (const cell of state.scenario.airspace.weather || []) {
    const p = worldToScreen(cell);
    const alpha = cell.severity === 'heavy' ? 0.16 : cell.severity === 'moderate' ? 0.11 : 0.07;
    ctx.save();
    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, cell.r * p.scale);
    gradient.addColorStop(0, `rgba(255, 90, 122, ${alpha * 1.5})`);
    gradient.addColorStop(0.55, `rgba(255, 209, 102, ${alpha})`);
    gradient.addColorStop(1, 'rgba(83, 228, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, cell.r * p.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.25)';
    ctx.setLineDash([8, 7]);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 209, 102, 0.78)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(cell.id, p.x + 8, p.y - 8);
    ctx.restore();
  }
}

function drawRunways() {
  for (const runway of state.scenario.airspace.runways) {
    const v = degToVector(runway.heading);
    const a = worldToScreen({ x: runway.x - v.x * runway.length / 2, y: runway.y - v.y * runway.length / 2 });
    const b = worldToScreen({ x: runway.x + v.x * runway.length / 2, y: runway.y + v.y * runway.length / 2 });
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(238, 247, 255, 0.82)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 10]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(238, 247, 255, 0.9)';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(runway.id, b.x + 8, b.y - 8);
    ctx.restore();
  }
}

function drawAutoLandingPaths() {
  const autoArrivals = state.active.filter(a => a.kind === 'arrival' && a.autoLand);
  if (!autoArrivals.length) return;
  ctx.save();
  for (const aircraft of autoArrivals) {
    const runway = getRunway(aircraft.targetRunway);
    if (!runway) continue;
    const geo = runwayLandingGeometry(runway);
    const final = worldToScreen(geo.finalFix);
    const threshold = worldToScreen(geo.threshold);
    const touchdown = worldToScreen(geo.touchdown);
    const plane = worldToScreen(aircraft);
    ctx.strokeStyle = 'rgba(119, 246, 178, 0.42)';
    ctx.lineWidth = 2;
    ctx.setLineDash([9, 8]);
    ctx.beginPath();
    ctx.moveTo(plane.x, plane.y);
    ctx.lineTo(final.x, final.y);
    ctx.lineTo(threshold.x, threshold.y);
    ctx.lineTo(touchdown.x, touchdown.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(119, 246, 178, 0.95)';
    ctx.beginPath();
    ctx.arc(final.x, final.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText('AUTO FINAL', final.x + 8, final.y - 8);
  }
  ctx.restore();
}

function drawGatesAndFixes() {
  ctx.save();
  for (const gate of state.scenario.airspace.gates) {
    const p = worldToScreen(gate);
    const bearing = gate.bearing * DEG;
    const tangent = bearing + Math.PI / 2;
    const len = 36;
    ctx.strokeStyle = 'rgba(255, 209, 102, 0.85)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(tangent) * len / 2, p.y - Math.sin(tangent) * len / 2);
    ctx.lineTo(p.x - Math.cos(tangent) * len / 2, p.y + Math.sin(tangent) * len / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 209, 102, 0.92)';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(gate.label || gate.id, p.x + 8, p.y + 4);
  }
  for (const fix of state.scenario.airspace.fixes) {
    const p = worldToScreen(fix);
    ctx.strokeStyle = 'rgba(122, 167, 255, 0.78)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y); ctx.lineTo(p.x + 6, p.y);
    ctx.moveTo(p.x, p.y - 6); ctx.lineTo(p.x, p.y + 6);
    ctx.stroke();
    ctx.fillStyle = 'rgba(122, 167, 255, 0.86)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(fix.label || fix.id, p.x + 8, p.y + 4);
  }
  ctx.restore();
}

function drawAircraft(aircraft) {
  const p = worldToScreen(aircraft);
  const color = aircraft.conflict ? '#ff5a7a' : aircraft.kind === 'arrival' ? '#53e4ff' : '#77f6b2';
  const selected = aircraft.id === state.selectedId;
  ctx.save();
  if (aircraft.trail.length > 1) {
    ctx.strokeStyle = aircraft.conflict ? 'rgba(255, 90, 122, 0.34)' : aircraft.kind === 'arrival' ? 'rgba(83, 228, 255, 0.22)' : 'rgba(119, 246, 178, 0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    aircraft.trail.forEach((t, idx) => {
      const tp = worldToScreen(t);
      if (idx === 0) ctx.moveTo(tp.x, tp.y); else ctx.lineTo(tp.x, tp.y);
    });
    ctx.stroke();
  }

  const v = degToVector(aircraft.heading);
  ctx.strokeStyle = aircraft.kind === 'arrival' ? 'rgba(83, 228, 255, 0.48)' : 'rgba(119, 246, 178, 0.48)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + v.x * 42, p.y - v.y * 42);
  ctx.stroke();

  if (selected) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.36)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.translate(p.x, p.y);
  ctx.rotate(aircraft.heading * DEG);
  ctx.fillStyle = color;
  ctx.shadowBlur = 18;
  ctx.shadowColor = color;
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(8, 10);
  ctx.lineTo(0, 5);
  ctx.lineTo(-8, 10);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();

  ctx.save();
  ctx.fillStyle = color;
  ctx.font = selected ? '700 13px ui-monospace, monospace' : '12px ui-monospace, monospace';
  const alt = Math.round(aircraft.altitude / 100).toString().padStart(3, '0');
  const spd = Math.round(aircraft.speed).toString();
  const route = aircraft.kind === 'departure' ? `→${aircraft.targetExit}` : `→${aircraft.targetRunway}`;
  const mode = aircraft.autoLand ? ' AUTO' : '';
  ctx.fillText(`${aircraft.callsign} ${alt} ${spd} ${route}${mode}`, p.x + 14, p.y - 10);
  ctx.restore();
}

function drawDrag() {
  if (!state.drag) return;
  const aircraft = selectedAircraft();
  if (!aircraft) return;
  const a = worldToScreen(aircraft);
  const b = worldToScreen(state.drag.point);
  const hdg = bearingBetween(aircraft, state.drag.point);
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.setLineDash([7, 7]);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillText(`HDG ${Math.round(hdg).toString().padStart(3, '0')}`, b.x + 12, b.y - 8);
  ctx.restore();
}

function draw() {
  resizeCanvasToDisplaySize();
  const rect = canvas.getBoundingClientRect();
  drawBackground(rect);
  drawWeather();
  drawRunways();
  drawAutoLandingPaths();
  drawGatesAndFixes();
  for (const aircraft of state.active) drawAircraft(aircraft);
  drawDrag();
  if (state.gameOver) drawOverlay('SIMULATION TERMINATED');
  else if (!state.running && state.time > 0) drawOverlay('SCENARIO COMPLETE');
  else if (!state.running) drawOverlay('PRESS START');
  else if (state.paused) drawOverlay('PAUSED');
}

function drawOverlay(text) {
  const rect = canvas.getBoundingClientRect();
  ctx.save();
  ctx.fillStyle = 'rgba(4, 12, 24, 0.52)';
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = 'rgba(238, 247, 255, 0.92)';
  ctx.font = '900 32px ui-sans-serif, system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(text, rect.width / 2, rect.height / 2);
  ctx.restore();
}

function updateUI() {
  ui.score.textContent = String(Math.round(state.score));
  ui.safety.textContent = `${Math.round(state.safety)}%`;
  ui.clock.textContent = formatTime(state.time);
  ui.pauseBtn.textContent = state.paused ? '继续' : '暂停';
  ui.startBtn.disabled = state.running && !state.gameOver;
  ui.takeoffBtn.disabled = !state.running || state.paused || state.gameOver || state.queue.length === 0;

  const aircraft = selectedAircraft();
  if (aircraft) {
    ui.selectedBadge.textContent = aircraft.autoLand ? '自动落地' : aircraft.kind === 'arrival' ? '进近' : '离场';
    ui.selectedBadge.className = `badge live${aircraft.autoLand ? ' autoland' : ''}`;
    ui.selectedDetails.className = 'details';
    const modeText = aircraft.autoLand
      ? `${aircraft.autoLand.phase === 'vector' ? '自动引导' : aircraft.autoLand.phase === 'capture' ? '截获五边' : '自动下滑'} · ${aircraft.autoLand.guidance || '自动进近'}`
      : aircraft.kind === 'arrival' ? '人工进近' : '离场管制';
    ui.selectedDetails.innerHTML = `
      <div class="details-grid">
        <div><span>呼号</span><strong>${aircraft.callsign}</strong></div>
        <div><span>机型</span><strong>${aircraft.type}</strong></div>
        <div><span>航向</span><strong>${Math.round(aircraft.heading).toString().padStart(3, '0')} → ${Math.round(aircraft.targetHeading).toString().padStart(3, '0')}</strong></div>
        <div><span>高度</span><strong>${Math.round(aircraft.altitude)} ft → ${Math.round(aircraft.assignedAltitude ?? aircraft.altitude)} ft</strong></div>
        <div><span>速度</span><strong>${Math.round(aircraft.speed)} kt → ${Math.round(aircraft.targetSpeed ?? aircraft.speed)} kt</strong></div>
        <div><span>目标</span><strong>${aircraft.kind === 'departure' ? aircraft.targetExit : aircraft.targetRunway}</strong></div>
        <div class="span-2"><span>模式</span><strong>${modeText}</strong></div>
      </div>`;
  } else {
    ui.selectedBadge.textContent = '未选择';
    ui.selectedBadge.className = 'badge';
    ui.selectedDetails.className = 'details empty';
    ui.selectedDetails.textContent = '在雷达上点击飞机，或从离场队列中放行一架飞机。';
  }

  const limit = state.scenario?.airspace.groundHoldLimitSec ?? 75;
  if (!state.queue.length) {
    ui.queueList.innerHTML = '<div class="details empty">暂无等待离场的飞机。</div>';
  } else {
    ui.queueList.innerHTML = state.queue.map(item => {
      const wait = Math.max(0, state.time - item.enqueuedAt);
      const cls = wait > limit * 0.8 ? 'danger' : wait > limit * 0.55 ? 'warn' : '';
      return `<article class="queue-card ${cls}">
        <header><strong>${item.callsign}</strong><span class="badge">${Math.round(wait)}s</span></header>
        <small>${item.type} · ${item.runway} · 交接 ${item.targetExit} · ${item.targetAltitude} ft</small>
      </article>`;
    }).join('');
  }
}

function findAircraftAt(worldPoint) {
  let best = null;
  let bestDist = Infinity;
  for (const aircraft of state.active) {
    const d = distance(worldPoint, aircraft);
    if (d < bestDist) { bestDist = d; best = aircraft; }
  }
  return bestDist < 0.045 ? best : null;
}

function onPointerDown(event) {
  if (!state.scenario) return;
  const world = screenToWorld(event.clientX, event.clientY);
  const hit = findAircraftAt(world);
  if (hit) {
    state.selectedId = hit.id;
    state.drag = { point: world };
  } else if (selectedAircraft()) {
    state.drag = { point: world };
  }
  updateUI();
}

function onPointerMove(event) {
  if (!state.drag) return;
  state.drag.point = screenToWorld(event.clientX, event.clientY);
}

function onPointerUp(event) {
  if (!state.drag) return;
  const aircraft = selectedAircraft();
  const point = screenToWorld(event.clientX, event.clientY);
  if (aircraft && distance(aircraft, point) > 0.04) {
    commandHeading(aircraft, bearingBetween(aircraft, point), '转向');
  }
  state.drag = null;
}

function bindEvents() {
  ui.startBtn.addEventListener('click', () => {
    if (state.gameOver) loadScenario(state.scenario.id);
    state.running = true;
    state.paused = false;
    log('模拟开始。', 'ok');
    updateUI();
  });
  ui.pauseBtn.addEventListener('click', () => {
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    log(state.paused ? '模拟暂停。' : '模拟继续。');
    updateUI();
  });
  ui.resetBtn.addEventListener('click', () => loadScenario(state.scenario.id));
  ui.scenarioSelect.addEventListener('change', () => loadScenario(ui.scenarioSelect.value));
  ui.trafficSelect.addEventListener('change', () => {
    state.trafficProfile = ui.trafficSelect.value;
    localStorage.setItem(TRAFFIC_PROFILE_KEY, state.trafficProfile);
    loadScenario(state.scenario.id);
  });
  ui.speedSelect.addEventListener('change', () => { state.speed = Number(ui.speedSelect.value); });
  ui.takeoffBtn.addEventListener('click', clearTakeoff);
  ui.landBtn.addEventListener('click', clearLanding);
  ui.handoffBtn.addEventListener('click', manualHandoff);
  ui.directBtn.addEventListener('click', () => commandDirect(ui.directSelect.value));
  ui.clearLogBtn.addEventListener('click', () => { ui.log.innerHTML = ''; });

  document.querySelectorAll('[data-turn]').forEach(btn => {
    btn.addEventListener('click', () => {
      const aircraft = selectedAircraft();
      if (!aircraft) return toast('请选择飞机。', 'warn');
      commandHeading(aircraft, aircraft.targetHeading + Number(btn.dataset.turn));
    });
  });
  document.querySelectorAll('[data-alt]').forEach(btn => btn.addEventListener('click', () => commandAltitude(Number(btn.dataset.alt))));
  document.querySelectorAll('[data-speed]').forEach(btn => btn.addEventListener('click', () => commandSpeed(Number(btn.dataset.speed))));

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function loop(now) {
  const rawDt = Math.min(0.08, (now - state.lastFrame) / 1000);
  state.lastFrame = now;
  update(rawDt * state.speed);
  draw();
  requestAnimationFrame(loop);
}

bindEvents();
loadScenarios().then(() => {
  state.lastFrame = performance.now();
  requestAnimationFrame(loop);
});
