import * as THREE from 'https://unpkg.com/three@0.162.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.162.0/examples/jsm/controls/OrbitControls.js';

const EARTH_RADIUS = 6371; // km
let config = {
    altitude: 690,
    inclination: 53 * (Math.PI / 180),
    totalSatellites: 96,
    planes: 8
};

let time = 0;
let timeSpeed = 0.01;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 10, 50000);
camera.position.set(0, 5000, 15000);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

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

// Starfield
const starGeometry = new THREE.SphereGeometry(40000, 32, 32);
const starMaterial = new THREE.MeshBasicMaterial({
    map: textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/galaxy_starfield.png'),
    side: THREE.BackSide
});
const stars = new THREE.Mesh(starGeometry, starMaterial);
scene.add(stars);

// Earth Atmosphere Glow
const atmosGeometry = new THREE.SphereGeometry(EARTH_RADIUS * 1.015, 128, 128);
const atmosMaterial = new THREE.MeshBasicMaterial({
    color: 0x4477ff,
    transparent: true,
    opacity: 0.15,
    side: THREE.BackSide
});
const atmosphere = new THREE.Mesh(atmosGeometry, atmosMaterial);
scene.add(atmosphere);

// Latitude Guide Lines (Helping visualize the 53 degree bounds)
const createLatLine = (lat, color) => {
    const rad = EARTH_RADIUS * 1.02;
    const y = rad * Math.sin(lat * Math.PI / 180);
    const r = rad * Math.cos(lat * Math.PI / 180);
    const points = [];
    for (let i = 0; i <= 64; i++) {
        const theta = (i / 64) * Math.PI * 2;
        points.push(new THREE.Vector3(r * Math.cos(theta), y, r * Math.sin(theta)));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.5 });
    return new THREE.Line(geometry, material);
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

// Earth Axis Tilt - REMOVED for better latitude alignment
earth.rotation.y = Math.PI; 
atmosphere.rotation.y = Math.PI;

// Satellites and Paths groups
let satellites = [];
let constellationGroup = new THREE.Group();
scene.add(constellationGroup);

const satGeometry = new THREE.SphereGeometry(60, 12, 12);
const satMaterial = new THREE.MeshBasicMaterial({ color: 0x00ffcc });

const createConstellation = () => {
    // Clear previous constellation
    while(constellationGroup.children.length > 0){ 
        constellationGroup.remove(constellationGroup.children[0]); 
    }
    satellites = [];

    const satsPerPlane = Math.ceil(config.totalSatellites / config.planes);
    const orbitalRadius = EARTH_RADIUS + config.altitude;

    for (let p = 0; p < config.planes; p++) {
        const raan = (p / config.planes) * Math.PI * 2;
        
        for (let s = 0; s < satsPerPlane; s++) {
            if (satellites.length >= config.totalSatellites) break;

            const sat = new THREE.Mesh(satGeometry, satMaterial);
            const meanAnomaly = (s / satsPerPlane) * Math.PI * 2;
            
            satellites.push({
                mesh: sat,
                raan: raan,
                meanAnomaly: meanAnomaly,
                orbitalRadius: orbitalRadius
            });
            constellationGroup.add(sat);

            // Orbit Path
            const curve = new THREE.EllipseCurve(0, 0, orbitalRadius, orbitalRadius, 0, 2 * Math.PI, false, 0);
            const points = curve.getPoints(120);
            const pathGeometry = new THREE.BufferGeometry().setFromPoints(points);
            const pathMaterial = new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.2 });
            const pathLine = new THREE.Line(pathGeometry, pathMaterial);
            
            const orbitGroup = new THREE.Group();
            orbitGroup.add(pathLine);
            pathLine.rotation.x = Math.PI / 2; // Start in Equatorial Plane (XZ)
            
            // Tilt the orbit by inclination and rotate by RAAN
            orbitGroup.rotation.x = config.inclination;
            orbitGroup.rotation.y = raan;
            constellationGroup.add(orbitGroup);
        }
    }
};

createConstellation();

const updateSatellites = () => {
    satellites.forEach((sat) => {
        const angle = sat.meanAnomaly + time;
        
        // 1. Position in orbital plane (relative to ascending node)
        const x_p = sat.orbitalRadius * Math.cos(angle);
        const z_p = -sat.orbitalRadius * Math.sin(angle); // Inverted for Eastward (CW) motion
        
        // 2. Rotate around X-axis by inclination
        const y_incl = z_p * Math.sin(config.inclination);
        const z_incl = z_p * Math.cos(config.inclination);
        const x_incl = x_p;
        
        // 3. Rotate around Y-axis (North axis) by RAAN
        const finalX = x_incl * Math.cos(sat.raan) + z_incl * Math.sin(sat.raan);
        const finalY = y_incl; // Latitude component
        const finalZ = -x_incl * Math.sin(sat.raan) + z_incl * Math.cos(sat.raan);
        
        sat.mesh.position.set(finalX, finalY, finalZ);
    });
};

// Marker for focus point
const markerGeometry = new THREE.SphereGeometry(100, 16, 16);
const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff3366 });
const focusMarker = new THREE.Mesh(markerGeometry, markerMaterial);
focusMarker.visible = false;
scene.add(focusMarker);

const latLonToXYZ = (lat, lon, radius) => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    
    const x = -(radius * Math.sin(phi) * Math.cos(theta));
    const z = (radius * Math.sin(phi) * Math.sin(theta));
    const y = (radius * Math.cos(phi));
    
    return new THREE.Vector3(x, y, z);
};

// Camera Animation state
let targetCameraPos = camera.position.clone();
let isAnimating = false;

const focusOnLocation = (lat, lon) => {
    const groundPos = latLonToXYZ(lat, lon, EARTH_RADIUS);
    const viewPos = latLonToXYZ(lat, lon, EARTH_RADIUS + 3000); // 3000km altitude for view
    
    focusMarker.position.copy(groundPos);
    focusMarker.visible = true;
    
    targetCameraPos.copy(viewPos);
    isAnimating = true;
    
    // Smoothly transition controls target to the ground position
    // controls.target.copy(groundPos);
};

// UI Handling
const inputs = {
    altitude: document.getElementById('input-altitude'),
    inclination: document.getElementById('input-inclination'),
    total: document.getElementById('input-total'),
    planes: document.getElementById('input-planes'),
    speed: document.getElementById('timeSpeed'),
    lat: document.getElementById('input-lat'),
    lon: document.getElementById('input-lon')
};

const btnFocus = document.getElementById('btn-focus');
const btnReset = document.getElementById('btn-reset');

const vals = {
    altitude: document.getElementById('val-altitude'),
    inclination: document.getElementById('val-inclination'),
    total: document.getElementById('val-total'),
    planes: document.getElementById('val-planes')
};

const updateConfig = () => {
    config.altitude = parseInt(inputs.altitude.value);
    config.inclination = parseInt(inputs.inclination.value) * (Math.PI / 180);
    config.totalSatellites = parseInt(inputs.total.value);
    config.planes = parseInt(inputs.planes.value);

    // Update UI text
    vals.altitude.innerText = inputs.altitude.value;
    vals.inclination.innerText = inputs.inclination.value;
    vals.total.innerText = inputs.total.value;
    vals.planes.innerText = inputs.planes.value;

    createConstellation();
    updateGuideLines();
};

Object.keys(inputs).forEach(key => {
    const input = inputs[key];
    input.addEventListener('input', (e) => {
        if (e.target.id === 'timeSpeed') {
            timeSpeed = parseFloat(e.target.value) / 1000;
        } else if (['input-lat', 'input-lon'].includes(e.target.id)) {
            // Lat/Lon don't trigger constellation update
        } else {
            updateConfig();
        }
    });
});

btnFocus.addEventListener('click', () => {
    const lat = parseFloat(inputs.lat.value);
    const lon = parseFloat(inputs.lon.value);
    focusOnLocation(lat, lon);
});

btnReset.addEventListener('click', () => {
    targetCameraPos.set(0, 5000, 15000);
    focusMarker.visible = false;
    isAnimating = true;
    controls.target.set(0, 0, 0);
});

const animate = () => {
    requestAnimationFrame(animate);
    
    if (isAnimating) {
        camera.position.lerp(targetCameraPos, 0.05);
        if (camera.position.distanceTo(targetCameraPos) < 1) {
            isAnimating = false;
        }
    }
    
    time += timeSpeed;
    // Earth rotates West to East (CW when looking from top in our coordinate system)
    earth.rotation.y -= 0.0002;
    atmosphere.rotation.y -= 0.0002;
    updateSatellites();
    controls.update();
    renderer.render(scene, camera);
};

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();