import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- CONFIGURATION & CONSTANTS ---
const EARTH_RADIUS = 6371; // km
const FOOTPRINT_RADIUS = 1600; // km
const FOOTPRINT_OFFSET = 15; // km above surface
const MAX_ANTENNAS = 4;
const MAX_CAPACITY = 96; // Fixed grid slots

let config = {
    altitude: 690,
    inclination: 53 * (Math.PI / 180),
    totalSatellites: 96,
    planes: 96, 
    phasing: 56
};

let time = 0;
let isAnimating = false;
let targetCameraPos = new THREE.Vector3(0, 5000, EARTH_RADIUS + 8000);

// Reusable objects for performance
const _vec1 = new THREE.Vector3();
const _vec2 = new THREE.Vector3();
const _vec3 = new THREE.Vector3();
const _mouse = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();

// --- SCENE SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 10, 100000);
camera.position.copy(targetCameraPos);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.addEventListener('start', () => isAnimating = false);

scene.add(new THREE.AmbientLight(0x404040, 2));
const sunLight = new THREE.DirectionalLight(0xf0f8ff, 1.5);
sunLight.position.set(5000, 3000, 5000);
scene.add(sunLight);

// --- TEXTURES & ASSETS ---
const textureLoader = new THREE.TextureLoader();
const earthTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg');
const earthBumpMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg');
const earthSpecularMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg');
const earthNightMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_lights_2048.png');
const earthCloudsMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_clouds_2048.png');
const satelliteTexture = textureLoader.load('AST Bluebird.png');

// --- EARTH & ATMOSPHERE ---
const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS, 128, 128),
    new THREE.MeshPhongMaterial({ 
        map: earthTexture, 
        bumpMap: earthBumpMap, 
        bumpScale: 100, 
        specularMap: earthSpecularMap, 
        specular: new THREE.Color(0x223344),
        shininess: 15,
        emissiveMap: earthNightMap,
        emissive: new THREE.Color(0xaaccff),
        emissiveIntensity: 0.7
    })
);
earth.rotation.y = Math.PI;
scene.add(earth);

const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS + 25, 128, 128),
    new THREE.MeshLambertMaterial({ 
        map: earthCloudsMap, 
        transparent: true, 
        opacity: 0.4, 
        depthWrite: false,
        alphaTest: 0.01
    })
);
clouds.rotation.y = Math.PI;
scene.add(clouds);

const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.025, 128, 128),
    new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.15, side: THREE.BackSide })
);
atmosphere.rotation.y = Math.PI;
scene.add(atmosphere);

scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(40000, 32, 32),
    new THREE.MeshBasicMaterial({ map: textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/galaxy_starfield.png'), side: THREE.BackSide })
));

// --- GROUND STATIONS (GWs) ---
const latLonToXYZ = (lat, lon, radius) => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -(radius * Math.sin(phi) * Math.cos(theta)),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
    );
};

let gateways = [];
const gatewayGroup = new THREE.Group();
const gatewayBeamGroup = new THREE.Group();
earth.add(gatewayGroup);
scene.add(gatewayBeamGroup);

const createGateway = (localPos) => {
    const marker = new THREE.Mesh(
        new THREE.SphereGeometry(120, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true })
    );
    marker.position.copy(localPos);
    
    const gwBeams = [];
    for (let i = 0; i < MAX_ANTENNAS; i++) {
        const beam = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
            new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.9, linewidth: 2, depthTest: true })
        );
        beam.visible = false;
        gwBeams.push(beam);
        gatewayBeamGroup.add(beam);
    }
    return { marker, beams: gwBeams };
};

// Initial Gateway
const midlandPos = latLonToXYZ(31.9974, -102.0779, EARTH_RADIUS);
const firstGW = createGateway(midlandPos);
firstGW.marker.visible = false;
gateways.push(firstGW);
gatewayGroup.add(firstGW.marker);

// --- GUIDE LINES ---
const guideLines = new THREE.Group();
scene.add(guideLines);

const createLatLine = (lat, color) => {
    const rad = EARTH_RADIUS * 1.02;
    const y = rad * Math.sin(lat * Math.PI / 180);
    const r = rad * Math.cos(lat * Math.PI / 180);
    const points = [];
    for (let i = 0; i <= 128; i++) {
        const theta = (i / 128) * Math.PI * 2;
        points.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.3, dashSize: 200, gapSize: 100 }));
    line.computeLineDistances();
    return line;
};

const updateGuideLines = () => {
    while(guideLines.children.length > 0) guideLines.remove(guideLines.children[0]);
    const lat = config.inclination * (180 / Math.PI);
    guideLines.add(createLatLine(lat, 0xff0000));
    guideLines.add(createLatLine(-lat, 0xff0000));
    guideLines.add(createLatLine(0, 0xffffff));
};

// --- CONSTELLATION ---
let satellites = [];
const satellitePool = []; 
const constellationGroup = new THREE.Group();
const footprintGroup = new THREE.Group();
const orbitGroup = new THREE.Group();
scene.add(constellationGroup);
scene.add(orbitGroup);
earth.add(footprintGroup);

const createSatelliteObject = (haloGeom) => {
    const satGroup = new THREE.Group();
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(250, 250), new THREE.MeshBasicMaterial({ map: satelliteTexture, color: 0xffcc00, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1 }));
    satGroup.add(icon);
    const footprint = new THREE.Mesh(haloGeom, new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.08, side: THREE.FrontSide, depthWrite: false }));
    return { mesh: satGroup, icon, footprint };
};

const createConstellation = () => {
    const orbitalRadius = EARTH_RADIUS + config.altitude;
    const F = config.phasing;

    const angleRadius = FOOTPRINT_RADIUS / EARTH_RADIUS;
    const haloGeom = new THREE.SphereGeometry(EARTH_RADIUS + FOOTPRINT_OFFSET, 32, 16, 0, Math.PI * 2, 0, angleRadius);
    haloGeom.rotateX(Math.PI / 2);

    if (satellitePool.length === 0) {
        for (let i = 0; i < MAX_CAPACITY; i++) {
            const newSat = createSatelliteObject(haloGeom);
            satellitePool.push(newSat);
            constellationGroup.add(newSat.mesh);
            footprintGroup.add(newSat.footprint);
        }
    }

    while(orbitGroup.children.length > 0) orbitGroup.remove(orbitGroup.children[0]);
    const oldGeom = satellitePool[0]?.footprint.geometry;
    satellitePool.forEach(s => { s.mesh.visible = false; s.footprint.visible = false; s.footprint.geometry = haloGeom; });
    if (oldGeom) oldGeom.dispose();

    satellites = [];
    for (let n = 0; n < config.totalSatellites; n++) {
        const sat = satellitePool[n];
        sat.mesh.visible = true;
        sat.footprint.visible = inputs.fov.checked;
        const raan = (n / MAX_CAPACITY) * Math.PI * 2;
        const meanAnomaly = (n * F * Math.PI * 2) / MAX_CAPACITY;
        satellites.push({ mesh: sat.mesh, icon: sat.icon, footprint: sat.footprint, raan, meanAnomaly, orbitalRadius });

        const curve = new THREE.EllipseCurve(0, 0, orbitalRadius, orbitalRadius, 0, 2 * Math.PI, false, 0);
        const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(120)), new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.1 }));
        orbitLine.rotation.x = Math.PI / 2;
        const planeGroup = new THREE.Group();
        planeGroup.rotation.x = config.inclination;
        planeGroup.rotation.y = raan;
        planeGroup.add(orbitLine);
        orbitGroup.add(planeGroup);
    }
};

const updateSatellites = () => {
    satellites.forEach((sat) => {
        const angle = sat.meanAnomaly + time;
        const zp = -sat.orbitalRadius * Math.sin(angle);
        const y_incl = zp * Math.sin(config.inclination);
        const z_incl = zp * Math.cos(config.inclination);
        const xp = sat.orbitalRadius * Math.cos(angle);
        sat.mesh.position.set(xp * Math.cos(sat.raan) + z_incl * Math.sin(sat.raan), y_incl, -xp * Math.sin(sat.raan) + z_incl * Math.cos(sat.raan));
        sat.icon.lookAt(0, 0, 0);
        sat.footprint.lookAt(sat.mesh.position);
    });
};

// --- CONNECTIVITY LOOP ---
const updateConnectivity = () => {
    gateways.forEach(gw => gw.beams.forEach(b => b.visible = false));
    const isGatewayActive = inputs.toggle.checked;
    const isFOVActive = inputs.fov.checked;
    const maxGWs = parseInt(inputs.gateways.value);
    const activeSatSats = new Set();

    if (isGatewayActive) {
        gateways.forEach((gw, idx) => {
            gw.marker.visible = idx < maxGWs;
            if (!gw.marker.visible) return;
            gw.marker.getWorldPosition(_vec1);
            const groundNormal = _vec1.clone().normalize();
            const candidates = [];
            satellites.forEach(sat => {
                sat.mesh.getWorldPosition(_vec2);
                const vecToSat = _vec2.clone().sub(_vec1).normalize();
                const elevation = Math.asin(Math.max(-1, Math.min(1, groundNormal.dot(vecToSat)))) * (180 / Math.PI);
                if (elevation >= 10) candidates.push({ sat, elevation, worldPos: _vec2.clone() });
            });
            candidates.sort((a, b) => b.elevation - a.elevation);
            const activeLinksCount = Math.min(candidates.length, parseInt(inputs.antennas.value));
            for (let i = 0; i < activeLinksCount; i++) {
                const link = candidates[i];
                activeSatSats.add(link.sat);
                gw.beams[i].visible = true;
                gw.beams[i].geometry.setFromPoints([_vec1, link.worldPos]);
            }
            if (gateways.length === 1) {
                const stateEl = document.getElementById('conn-state');
                if (activeLinksCount > 0) {
                    stateEl.innerText = `${activeLinksCount} ANTENNA${activeLinksCount > 1 ? 'S' : ''}`;
                    stateEl.style.color = "#00ff00";
                    document.getElementById('conn-elev').innerText = candidates[0].elevation.toFixed(1) + "°";
                } else {
                    stateEl.innerText = "SEARCHING...";
                    stateEl.style.color = "#ffcc00";
                    document.getElementById('conn-elev').innerText = "---";
                }
            }
        });
    } else {
        gateways.forEach(gw => gw.marker.visible = false);
    }

    satellites.forEach(sat => {
        sat.footprint.visible = isFOVActive;
        if (activeSatSats.has(sat)) {
            sat.footprint.material.color.set(0x00ff88);
            sat.footprint.material.opacity = 0.25;
        } else {
            sat.footprint.material.color.set(0x00ccff);
            sat.footprint.material.opacity = 0.08;
        }
    });
    inputs.statusBox.style.display = (isGatewayActive && gateways.length === 1) ? 'block' : 'none';
};

// --- UI & INTERACTION ---
const inputs = {
    altitude: document.getElementById('input-altitude'),
    inclination: document.getElementById('input-inclination'),
    total: document.getElementById('input-total'),
    phasing: document.getElementById('input-phasing'),
    gateways: document.getElementById('input-gateways'),
    speed: document.getElementById('timeSpeed'),
    antennas: document.getElementById('input-antennas'),
    toggle: document.getElementById('gs-toggle'),
    fov: document.getElementById('fov-toggle'),
    statusBox: document.getElementById('gs-status-box'),
    headerInfo: document.getElementById('constellation-info')
};

const updateUI = () => {
    const values = ['altitude', 'inclination', 'total', 'phasing', 'antennas', 'gateways'];
    values.forEach(key => {
        const el = document.getElementById(`val-${key}`);
        if (el) el.innerText = inputs[key].value;
    });
    const T = inputs.total.value;
    inputs.headerInfo.innerText = `Walker Delta: ${inputs.inclination.value}°: ${T}/${T}/${inputs.phasing.value}`;
    const maxGWs = parseInt(inputs.gateways.value);
    while (gateways.length > maxGWs) {
        const removed = gateways.pop();
        gatewayGroup.remove(removed.marker);
        removed.beams.forEach(b => { b.visible = false; gatewayBeamGroup.remove(b); });
    }
};

const syncConfig = () => {
    config.altitude = parseInt(inputs.altitude.value);
    config.inclination = parseInt(inputs.inclination.value) * (Math.PI / 180);
    config.totalSatellites = parseInt(inputs.total.value);
    config.phasing = parseInt(inputs.phasing.value);
    createConstellation(); updateUI(); updateGuideLines();
};

Object.values(inputs).forEach(input => {
    if (!input || input.id === 'gs-status-box' || input.id === 'constellation-info') return;
    input.addEventListener('input', () => {
        const isConfig = !['input-antennas', 'fov-toggle', 'timeSpeed', 'gs-toggle', 'input-gateways'].includes(input.id);
        if (isConfig) syncConfig();
        else updateUI();
    });
});

inputs.toggle.addEventListener('change', (e) => {
    updateConnectivity();
    if (e.target.checked && gateways.length > 0) {
        gateways[gateways.length - 1].marker.getWorldPosition(_vec3);
        targetCameraPos.copy(_vec3.normalize().multiplyScalar(camera.position.length()));
        isAnimating = true;
    }
});

window.addEventListener('dblclick', (e) => {
    if (e.target.closest('#ui')) return;
    const rect = renderer.domElement.getBoundingClientRect();
    _mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    _raycaster.setFromCamera(_mouse, camera);
    const intersects = _raycaster.intersectObject(earth);
    if (intersects.length > 0) {
        earth.updateMatrixWorld();
        const localPoint = earth.worldToLocal(intersects[0].point.clone());
        const maxGWs = parseInt(inputs.gateways.value);
        if (gateways.length < maxGWs) {
            const newGW = createGateway(localPoint);
            gateways.push(newGW);
            gatewayGroup.add(newGW.marker);
        } else {
            const oldest = gateways.shift();
            oldest.marker.position.copy(localPoint);
            gateways.push(oldest);
        }
        if (inputs.toggle.checked) {
            targetCameraPos.copy(intersects[0].point.normalize().multiplyScalar(camera.position.length()));
            isAnimating = true;
        }
    }
});

const animate = () => {
    requestAnimationFrame(animate);
    if (isAnimating) {
        const d = camera.position.length();
        camera.position.lerp(targetCameraPos, 0.02);
        camera.position.normalize().multiplyScalar(d);
        if (camera.position.distanceTo(targetCameraPos) < 10) isAnimating = false;
    }
    const currentSpeed = parseFloat(inputs.speed.value);
    if (currentSpeed > 0) {
        time += currentSpeed / 1000;
        earth.rotation.y -= 0.0002;
        clouds.rotation.y -= 0.0003;
        atmosphere.rotation.y -= 0.0002;
    }
    updateSatellites(); updateConnectivity(); controls.update(); renderer.render(scene, camera);
};

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

createConstellation();
updateUI();
updateGuideLines();
animate();