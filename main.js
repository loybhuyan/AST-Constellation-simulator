import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const EARTH_RADIUS = 6371; // km
let config = {
    altitude: 690,
    inclination: 53 * (Math.PI / 180),
    totalSatellites: 96,
    planes: 96,
    phasing: 56
};

let time = 0;
let timeSpeed = 0.01;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 10, 100000);
// Initial view at 8,000km altitude
camera.position.set(0, 5000, EARTH_RADIUS + 8000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Stop camera animation on manual interaction
controls.addEventListener('start', () => {
    isAnimating = false;
});

// Lighting
const ambientLight = new THREE.AmbientLight(0x404040, 2); 
scene.add(ambientLight);
const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
sunLight.position.set(5000, 3000, 5000);
scene.add(sunLight);

// Texture Loader
const textureLoader = new THREE.TextureLoader();
const earthTexture = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg');
const earthBumpMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg');
const earthSpecularMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg');

// Earth
const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 128, 128);
const earthMaterial = new THREE.MeshPhongMaterial({
    map: earthTexture,
    bumpMap: earthBumpMap,
    bumpScale: 50,
    specularMap: earthSpecularMap,
    specular: new THREE.Color('grey'),
    shininess: 10
});
const earth = new THREE.Mesh(earthGeometry, earthMaterial);
scene.add(earth);

const latLonToXYZ = (lat, lon, radius) => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));
    return new THREE.Vector3(x, y, z);
};

// Static Ground Station (Midland, Texas) - Parented to Earth
const midlandMarker = new THREE.Mesh(new THREE.SphereGeometry(100, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff3366 }));
const midlandPos = latLonToXYZ(31.9974, -102.0779, EARTH_RADIUS);
midlandMarker.position.copy(midlandPos);
midlandMarker.visible = false;
earth.add(midlandMarker);

// Coverage Area around Midland (Filled translucent circle)
const areaRadius = 1414; 
const circleGeom = new THREE.CircleGeometry(areaRadius, 64);
const circleMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.25 });
const coverageCircle = new THREE.Mesh(circleGeom, circleMat);
coverageCircle.position.set(0, 0, 0); 
coverageCircle.lookAt(midlandPos.clone().multiplyScalar(2)); 
midlandMarker.add(coverageCircle);

// Atmosphere
const atmosGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 128, 128);
const atmosMaterial = new THREE.MeshBasicMaterial({ color: 0x4477ff, transparent: true, opacity: 0.15, side: THREE.BackSide });
const atmosphere = new THREE.Mesh(atmosGeometry, atmosMaterial);
scene.add(atmosphere);

// Starfield
const starGeometry = new THREE.SphereGeometry(40000, 32, 32); 
const starMaterial = new THREE.MeshBasicMaterial({
    map: textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/galaxy_starfield.png'),
    side: THREE.BackSide
});
const stars = new THREE.Mesh(starGeometry, starMaterial);
scene.add(stars);

// Latitude Guide Lines
const createLatLine = (lat, color) => {
    const rad = EARTH_RADIUS * 1.02;
    const y = rad * Math.sin(lat * Math.PI / 180);
    const r = rad * Math.cos(lat * Math.PI / 180);
    const points = [];
    for (let i = 0; i <= 128; i++) {
        const theta = (i / 128) * Math.PI * 2;
        points.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({ 
        color: color, 
        transparent: true, 
        opacity: 0.35, 
        dashSize: 200, 
        gapSize: 100 
    });
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances(); 
    return line;
};

const guideLines = new THREE.Group();
scene.add(guideLines);

const updateGuideLines = () => {
    while(guideLines.children.length > 0) guideLines.remove(guideLines.children[0]);
    const lat = config.inclination * (180 / Math.PI);
    guideLines.add(createLatLine(lat, 0xff0000));  // 53N
    guideLines.add(createLatLine(-lat, 0xff0000)); // 53S
    guideLines.add(createLatLine(0, 0xffffff));    // Equator
};
updateGuideLines();

// Earth Orientation
earth.rotation.y = Math.PI; 
atmosphere.rotation.y = Math.PI;

// Satellites
let satellites = [];
let constellationGroup = new THREE.Group();
scene.add(constellationGroup);

const satGeometry = new THREE.SphereGeometry(60, 12, 12);
const satMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffcc });

const createConstellation = () => {
    while(constellationGroup.children.length > 0) constellationGroup.remove(constellationGroup.children[0]);
    satellites = [];
    const orbitalRadius = EARTH_RADIUS + config.altitude;
    
    // Walker Delta Phasing: F * 360 / T
    const phaseOffsetPerPlane = (config.phasing * Math.PI * 2) / config.totalSatellites;
    const satsPerPlane = Math.floor(config.totalSatellites / config.planes);
    const remainder = config.totalSatellites % config.planes;

    for (let p = 0; p < config.planes; p++) {
        const raan = (p / config.planes) * Math.PI * 2;
        const planePhaseShift = p * phaseOffsetPerPlane;
        
        // Handle distribution even if T is not perfectly divisible by P
        const currentPlaneSats = p < remainder ? satsPerPlane + 1 : satsPerPlane;

        for (let s = 0; s < currentPlaneSats; s++) {
            const sat = new THREE.Mesh(satGeometry, satMaterial);
            // Even spacing within this specific plane ring
            const meanAnomaly = ((s / currentPlaneSats) * Math.PI * 2) + planePhaseShift;
            
            satellites.push({ mesh: sat, raan, meanAnomaly, orbitalRadius });
            constellationGroup.add(sat);
        }

        // Draw the orbital ring path for this plane
        const curve = new THREE.EllipseCurve(0, 0, orbitalRadius, orbitalRadius, 0, 2 * Math.PI, false, 0);
        const pathLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(120)), new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.1 }));
        const orbitGroup = new THREE.Group();
        pathLine.rotation.x = Math.PI / 2;
        orbitGroup.rotation.x = config.inclination;
        orbitGroup.rotation.y = raan;
        orbitGroup.add(pathLine);
        constellationGroup.add(orbitGroup);
    }
};
createConstellation();

const updateSatellites = () => {
    satellites.forEach((sat) => {
        const angle = sat.meanAnomaly + time;
        const x_p = sat.orbitalRadius * Math.cos(angle);
        const z_p = -sat.orbitalRadius * Math.sin(angle);
        const y_incl = z_p * Math.sin(config.inclination);
        const z_incl = z_p * Math.cos(config.inclination);
        const finalX = x_p * Math.cos(sat.raan) + z_incl * Math.sin(sat.raan);
        const finalY = y_incl;
        const finalZ = -x_p * Math.sin(sat.raan) + z_incl * Math.cos(sat.raan);
        sat.mesh.position.set(finalX, finalY, finalZ);
    });
};

// Connectivity Beams (Multi-link pool)
const beamGroup = new THREE.Group();
scene.add(beamGroup);
const maxLinkCount = 4;
const beams = [];
for (let i = 0; i < maxLinkCount; i++) {
    const beam = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ 
            color: 0xffff00, 
            transparent: true, 
            opacity: 0.4, 
            linewidth: 1,
            depthTest: true 
        })
    );
    beam.visible = false;
    beams.push(beam);
    beamGroup.add(beam);
}

// UI Handling
const inputs = {
    altitude: document.getElementById('input-altitude'),
    inclination: document.getElementById('input-inclination'),
    total: document.getElementById('input-total'),
    planes: document.getElementById('input-planes'),
    speed: document.getElementById('timeSpeed'),
    links: document.getElementById('input-links'),
    toggle: document.getElementById('gs-toggle'),
    statusBox: document.getElementById('gs-status-box')
};

const vals = {
    altitude: document.getElementById('val-altitude'),
    inclination: document.getElementById('val-inclination'),
    total: document.getElementById('val-total'),
    planes: document.getElementById('val-planes'),
    links: document.getElementById('val-links')
};

const updateConfig = () => {
    config.altitude = parseInt(inputs.altitude.value);
    config.inclination = parseInt(inputs.inclination.value) * (Math.PI / 180);
    config.totalSatellites = parseInt(inputs.total.value);
    config.planes = parseInt(inputs.planes.value);
    vals.altitude.innerText = inputs.altitude.value;
    vals.inclination.innerText = inputs.inclination.value;
    vals.total.innerText = inputs.total.value;
    vals.planes.innerText = inputs.planes.value;
    vals.links.innerText = inputs.links.value;
    createConstellation();
    updateGuideLines();
};

Object.keys(inputs).forEach(key => {
    const input = inputs[key];
    if (key === 'toggle' || key === 'statusBox') return;
    input.addEventListener('input', (e) => {
        if (e.target.id === 'timeSpeed') {} 
        else if (e.target.id === 'input-links') { vals.links.innerText = e.target.value; }
        else { updateConfig(); }
    });
});

// Camera Animation State
let targetCameraPos = new THREE.Vector3(0, 5000, EARTH_RADIUS + 8000);
let isAnimating = false;

inputs.toggle.addEventListener('change', (e) => {
    const active = e.target.checked;
    midlandMarker.visible = active;
    inputs.statusBox.style.display = active ? 'block' : 'none';
    
    if (active) {
        // Capture CURRENT distance
        const currentDist = camera.position.length();
        const worldPos = new THREE.Vector3();
        midlandMarker.getWorldPosition(worldPos);
        
        // Target at same distance
        const viewPos = worldPos.clone().normalize().multiplyScalar(currentDist);
        targetCameraPos.copy(viewPos);
        isAnimating = true;
    } else {
        beams.forEach(b => b.visible = false);
    }
});

const updateConnectivity = () => {
    beams.forEach(b => b.visible = false);
    if (!inputs.toggle.checked) return;

    const worldPos = new THREE.Vector3();
    midlandMarker.getWorldPosition(worldPos);
    const groundNormal = worldPos.clone().normalize();

    const candidates = satellites.map(sat => {
        const satPos = sat.mesh.position.clone();
        const vecToSat = satPos.clone().sub(worldPos).normalize();
        const elevation = Math.asin(Math.max(-1, Math.min(1, groundNormal.dot(vecToSat)))) * (180 / Math.PI);
        return { mesh: sat.mesh, elevation };
    }).filter(c => c.elevation >= 10);

    candidates.sort((a, b) => b.elevation - a.elevation);

    const linkLimit = parseInt(inputs.links.value);
    const activeLinks = Math.min(candidates.length, linkLimit);

    // Dynamic Coverage Circle Scaling (Capacity based)
    const maxScale = Math.sqrt(1 / 3); 
    const minScale = maxScale * 0.5;
    const t = (linkLimit - 1) / 3;
    const scaleFactor = minScale + (maxScale - minScale) * t;
    
    coverageCircle.scale.set(scaleFactor * 1.5, scaleFactor, 1);
    coverageCircle.visible = inputs.toggle.checked && candidates.length > 0;

    if (activeLinks > 0) {
        for (let i = 0; i < activeLinks; i++) {
            beams[i].visible = true;
            beams[i].geometry.setFromPoints([worldPos, candidates[i].mesh.position]);
        }
        document.getElementById('conn-state').innerText = activeLinks + (activeLinks === 1 ? " LINK" : " LINKS");
        document.getElementById('conn-state').style.color = "#00ff00";
        document.getElementById('conn-elev').innerText = candidates[0].elevation.toFixed(1) + "°";
    } else {
        document.getElementById('conn-state').innerText = "SEARCHING...";
        document.getElementById('conn-state').style.color = "#ffcc00";
        document.getElementById('conn-elev').innerText = "---";
    }
};

const animate = () => {
    requestAnimationFrame(animate);
    
    if (isAnimating) {
        const currentDist = camera.position.length(); // Capture current distance
        camera.position.lerp(targetCameraPos, 0.02);
        
        // ARC FIX: Force camera to stay on the sphere surface (constant altitude)
        // This prevents the camera from "zooming in" as it moves between points
        camera.position.normalize().multiplyScalar(currentDist);
        
        if (camera.position.distanceTo(targetCameraPos) < 10) {
            isAnimating = false;
        }
    }
    
    time += parseFloat(inputs.speed.value) / 1000;
    earth.rotation.y -= 0.0002;
    atmosphere.rotation.y -= 0.0002;
    updateSatellites();
    updateConnectivity();
    controls.update();
    renderer.render(scene, camera);
};

document.getElementById('btn-reset').addEventListener('click', () => { 
    const currentViewDir = camera.position.clone().normalize();
    targetCameraPos.copy(currentViewDir.multiplyScalar(EARTH_RADIUS + 8000));
    isAnimating = true;
    controls.target.set(0, 0, 0); 
});
window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
animate();