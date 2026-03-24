import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- CONFIGURATION & CONSTANTS ---
const EARTH_RADIUS = 6371; // km
const FOOTPRINT_RADIUS = 900; // km
const FOOTPRINT_OFFSET = 15; // km above surface
const MAX_ANTENNAS = 4;

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

// Reusable vectors for performance
const _vec1 = new THREE.Vector3();
const _vec2 = new THREE.Vector3();
const _mouse = new THREE.Vector2();
const _raycaster = new THREE.Raycaster();

// --- SCENE SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 10, 100000);
camera.position.copy(targetCameraPos);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.addEventListener('start', () => isAnimating = false);

// Lighting
scene.add(new THREE.AmbientLight(0x404040, 2));
const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.position.set(5000, 3000, 5000);
scene.add(sunLight);

// --- TEXTURES & ASSETS ---
const textureLoader = new THREE.TextureLoader();
const earthTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg');
const earthBumpMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg');
const earthSpecularMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg');
const satelliteTexture = textureLoader.load('AST Bluebird.png');

// --- EARTH & ATMOSPHERE ---
const earth = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS, 128, 128),
    new THREE.MeshPhongMaterial({ map: earthTexture, bumpMap: earthBumpMap, bumpScale: 50, specularMap: earthSpecularMap, specular: new THREE.Color('grey'), shininess: 10 })
);
earth.rotation.y = Math.PI;
scene.add(earth);

const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 128, 128),
    new THREE.MeshBasicMaterial({ color: 0x4477ff, transparent: true, opacity: 0.15, side: THREE.BackSide })
);
atmosphere.rotation.y = Math.PI;
scene.add(atmosphere);

scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(40000, 32, 32),
    new THREE.MeshBasicMaterial({ map: textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/galaxy_starfield.png'), side: THREE.BackSide })
));

// --- GROUND STATION (GW) ---
const latLonToXYZ = (lat, lon, radius) => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
        -(radius * Math.sin(phi) * Math.cos(theta)),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
    );
};

const midlandMarker = new THREE.Mesh(
    new THREE.SphereGeometry(120, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
);
midlandMarker.renderOrder = 1000;
midlandMarker.position.copy(latLonToXYZ(31.9974, -102.0779, EARTH_RADIUS));
midlandMarker.visible = false;
earth.add(midlandMarker);

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
    const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.3, dashSize: 200, gapSize: 100 })
    );
    line.computeLineDistances();
    return line;
};

const updateGuideLines = () => {
    while(guideLines.children.length > 0) guideLines.remove(guideLines.children[0]);
    const lat = config.inclination * (180 / Math.PI);
    guideLines.add(createLatLine(lat, 0xff0000));  // Max North Inclination
    guideLines.add(createLatLine(-lat, 0xff0000)); // Max South Inclination
    guideLines.add(createLatLine(0, 0xffffff));    // Equator
};

// --- CONSTELLATION ---
let satellites = [];
const constellationGroup = new THREE.Group();
const footprintGroup = new THREE.Group();
scene.add(constellationGroup);
earth.add(footprintGroup);

const createConstellation = () => {
    while(constellationGroup.children.length > 0) constellationGroup.remove(constellationGroup.children[0]);
    while(footprintGroup.children.length > 0) footprintGroup.remove(footprintGroup.children[0]);
    satellites = [];

    const orbitalRadius = EARTH_RADIUS + config.altitude;
    const phaseOffsetPerPlane = (config.phasing * Math.PI * 2) / config.totalSatellites;
    const satsPerPlane = Math.floor(config.totalSatellites / config.planes);
    const remainder = config.totalSatellites % config.planes;

    const angleRadius = FOOTPRINT_RADIUS / EARTH_RADIUS;
    const haloGeom = new THREE.SphereGeometry(EARTH_RADIUS + FOOTPRINT_OFFSET, 32, 16, 0, Math.PI * 2, 0, angleRadius);
    haloGeom.rotateX(Math.PI / 2);

    for (let p = 0; p < config.planes; p++) {
        const raan = (p / config.planes) * Math.PI * 2;
        const planePhaseShift = p * phaseOffsetPerPlane;
        const currentPlaneSats = p < remainder ? satsPerPlane + 1 : satsPerPlane;

        for (let s = 0; s < currentPlaneSats; s++) {
            const satGroup = new THREE.Group();
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: satelliteTexture, color: 0xffcc00 }));
            sprite.scale.set(250, 250, 1);
            sprite.material.rotation = (Math.random() - 0.5) * 0.5;
            satGroup.add(sprite);

            const footprint = new THREE.Mesh(haloGeom, new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.08, side: THREE.FrontSide, depthWrite: false }));
            footprint.visible = false;
            footprintGroup.add(footprint);

            const meanAnomaly = ((s / currentPlaneSats) * Math.PI * 2) + planePhaseShift;
            satellites.push({ mesh: satGroup, footprint, raan, meanAnomaly, orbitalRadius });
            constellationGroup.add(satGroup);
        }

        // Orbit path visual
        const curve = new THREE.EllipseCurve(0, 0, orbitalRadius, orbitalRadius, 0, 2 * Math.PI, false, 0);
        const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(120)), new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.1 }));
        orbitLine.rotation.x = Math.PI / 2;
        const orbitGroup = new THREE.Group();
        orbitGroup.rotation.x = config.inclination;
        orbitGroup.rotation.y = raan;
        orbitGroup.add(orbitLine);
        constellationGroup.add(orbitGroup);
    }
};

const updateSatellites = () => {
    satellites.forEach((sat) => {
        const angle = sat.meanAnomaly + time;
        const zp = -sat.orbitalRadius * Math.sin(angle);
        const y_incl = zp * Math.sin(config.inclination);
        const z_incl = zp * Math.cos(config.inclination);
        const xp = sat.orbitalRadius * Math.cos(angle);
        
        sat.mesh.position.set(
            xp * Math.cos(sat.raan) + z_incl * Math.sin(sat.raan),
            y_incl,
            -xp * Math.sin(sat.raan) + z_incl * Math.cos(sat.raan)
        );
        sat.footprint.lookAt(sat.mesh.position);
    });
};

// --- CONNECTIVITY & BEAMS ---
const beams = [];
const beamGroup = new THREE.Group();
scene.add(beamGroup);

for (let i = 0; i < MAX_ANTENNAS; i++) {
    const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.9, linewidth: 2, depthTest: true }));
    beam.visible = false;
    beams.push(beam);
    beamGroup.add(beam);
}

const updateConnectivity = () => {
    beams.forEach(b => b.visible = false);
    midlandMarker.getWorldPosition(_vec1); // GW world position
    const groundNormal = _vec1.clone().normalize();
    const isGatewayActive = inputs.toggle.checked;

    const candidates = [];
    satellites.forEach(sat => {
        sat.mesh.getWorldPosition(_vec2); // Sat world position
        const vecToSat = _vec2.clone().sub(_vec1).normalize();
        const elevation = Math.asin(Math.max(-1, Math.min(1, groundNormal.dot(vecToSat)))) * (180 / Math.PI);
        
        sat.footprint.visible = true;
        sat.footprint.material.color.set(0x00ccff);
        sat.footprint.material.opacity = 0.08;

        if (isGatewayActive && elevation >= 10) {
            candidates.push({ sat, elevation, worldPos: _vec2.clone() });
        }
    });

    if (!isGatewayActive) {
        document.getElementById('conn-state').innerText = "GATEWAY OFF";
        document.getElementById('conn-state').style.color = "#888";
        document.getElementById('conn-elev').innerText = "---";
        return;
    }

    candidates.sort((a, b) => b.elevation - a.elevation);
    const activeLinksCount = Math.min(candidates.length, parseInt(inputs.antennas.value));

    for (let i = 0; i < activeLinksCount; i++) {
        const link = candidates[i];
        link.sat.footprint.material.color.set(0x00ff88);
        link.sat.footprint.material.opacity = 0.25;
        beams[i].visible = true;
        beams[i].geometry.setFromPoints([_vec1, link.worldPos]);
    }

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
};

// --- UI & INTERACTION ---
const inputs = {
    altitude: document.getElementById('input-altitude'),
    inclination: document.getElementById('input-inclination'),
    total: document.getElementById('input-total'),
    planes: document.getElementById('input-planes'),
    speed: document.getElementById('timeSpeed'),
    antennas: document.getElementById('input-antennas'),
    toggle: document.getElementById('gs-toggle'),
    statusBox: document.getElementById('gs-status-box')
};

const updateUI = () => {
    document.getElementById('val-altitude').innerText = inputs.altitude.value;
    document.getElementById('val-inclination').innerText = inputs.inclination.value;
    document.getElementById('val-total').innerText = inputs.total.value;
    document.getElementById('val-planes').innerText = inputs.planes.value;
    document.getElementById('val-antennas').innerText = inputs.antennas.value;
};

const syncConfig = () => {
    config.altitude = parseInt(inputs.altitude.value);
    config.inclination = parseInt(inputs.inclination.value) * (Math.PI / 180);
    config.totalSatellites = parseInt(inputs.total.value);
    config.planes = parseInt(inputs.planes.value);
    createConstellation(); updateUI(); updateGuideLines();
};

Object.values(inputs).forEach(input => {
    input.addEventListener('input', () => {
        if (input.id === 'input-antennas') updateUI();
        else if (input.id !== 'timeSpeed' && input.id !== 'gs-toggle') syncConfig();
    });
});

inputs.toggle.addEventListener('change', (e) => {
    midlandMarker.visible = e.target.checked;
    inputs.statusBox.style.display = e.target.checked ? 'block' : 'none';
    if (e.target.checked) {
        midlandMarker.getWorldPosition(_vec1);
        targetCameraPos.copy(_vec1.normalize().multiplyScalar(camera.position.length()));
        isAnimating = true;
    }
});

window.addEventListener('dblclick', (e) => {
    if (e.target.closest('#ui')) return;
    _mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    _raycaster.setFromCamera(_mouse, camera);
    const intersects = _raycaster.intersectObject(earth);
    if (intersects.length > 0) {
        midlandMarker.position.copy(earth.worldToLocal(intersects[0].point.clone()));
        if (inputs.toggle.checked) {
            targetCameraPos.copy(intersects[0].point.normalize().multiplyScalar(camera.position.length()));
            isAnimating = true;
        }
    }
});

document.getElementById('btn-reset').addEventListener('click', () => { 
    targetCameraPos.copy(camera.position.clone().normalize().multiplyScalar(EARTH_RADIUS + 8000));
    isAnimating = true;
    controls.target.set(0, 0, 0); 
});

// --- MAIN LOOP ---
const animate = () => {
    requestAnimationFrame(animate);
    if (isAnimating) {
        const d = camera.position.length();
        camera.position.lerp(targetCameraPos, 0.02);
        camera.position.normalize().multiplyScalar(d);
        if (camera.position.distanceTo(targetCameraPos) < 10) isAnimating = false;
    }
    time += parseFloat(inputs.speed.value) / 1000;
    earth.rotation.y -= 0.0002;
    atmosphere.rotation.y -= 0.0002;
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