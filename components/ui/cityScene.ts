import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

// A small, deterministic architectural scene. No remote assets, network
// textures, controls dependency or post-processing pipeline are needed.
export type CityMood = "golden" | "blue";

const skyVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFragment = `
  varying vec2 vUv;
  uniform float uBlue;
  void main() {
    vec3 low = mix(vec3(1.0, .58, .32), vec3(.30, .30, .49), uBlue);
    vec3 high = mix(vec3(.19, .45, .65), vec3(.035, .07, .16), uBlue);
    vec3 col = mix(low, high, smoothstep(.28, .90, vUv.y));
    float haze = exp(-pow((vUv.y - .47) * 7.0, 2.0));
    col = mix(col, mix(vec3(1., .77, .48), vec3(.7, .43, .46), uBlue), haze * .32);
    float cloud = sin(vUv.x * 14. + sin(vUv.y * 35.) * 2.0) * .5 + .5;
    cloud *= exp(-pow((vUv.y - .69) * 32., 2.)) * .075;
    col += cloud;
    gl_FragColor = vec4(col, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const sunFragment = `
  varying vec2 vUv;
  uniform float uBlue;
  uniform float uFlare;
  void main() {
    float d = length(vUv - .5) * 2.;
    float disc = 1. - smoothstep(.31, .34, d);
    float bloom = exp(-d * d * 5.) * .34;
    vec3 color = mix(vec3(1.0, .65, .30), vec3(1.0, .84, .77), uBlue);
    gl_FragColor = vec4(color * (1.3 + uFlare * .2), (disc + bloom) * (1. - smoothstep(.7, 1., d)));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// Subtle facade detail is evaluated on world coordinates: recessed floor
// bands, slender mullions, sky reflected on glass and a few occupied windows.
const facadeVertex = `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.);
    vWorld = world.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const facadeFragment = `
  varying vec3 vWorld;
  varying vec3 vNormal;
  uniform vec3 uTint;
  uniform float uBlue;
  uniform float uWarm;
  void main() {
    vec3 n = normalize(vNormal);
    float side = abs(n.x);
    float across = mix(vWorld.x, vWorld.z, side);
    float floorLine = smoothstep(.80, .96, fract(vWorld.y * 2.8));
    float mullion = smoothstep(.87, .97, fract(across * 3.5));
    float light = dot(n, normalize(vec3(-.7, .6, .8))) * .28 + .73;
    vec3 glass = mix(uTint, vec3(.045, .11, .22), uBlue * .67);
    glass *= light;
    glass += vec3(.18, .13, .075) * pow(max(n.x * -.7 + n.z * .5, 0.), 4.) * (1. - uBlue * .55);
    float streak = sin(across * 1.9 + vWorld.y * .1) * .035;
    glass += streak;
    glass = mix(glass, glass * .43 + vec3(.035), max(floorLine * .65, mullion * .6));
    vec2 cell = floor(vec2(across * 3.5, vWorld.y * 2.8));
    float occupied = step(.78, fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453));
    glass += vec3(1., .43, .09) * occupied * (1. - floorLine) * (1. - mullion) * (uBlue * .20 + uWarm);
    glass = mix(glass, uTint * 1.02, smoothstep(.6, .95, n.y));
    float dist = length(cameraPosition - vWorld);
    float fog = 1. - exp(-dist * dist * .00024);
    vec3 fogColor = mix(vec3(.65, .58, .52), vec3(.13, .18, .30), uBlue);
    gl_FragColor = vec4(mix(glass, fogColor, fog), 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createCityScene(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeed0bb);
  const camera = new THREE.PerspectiveCamera(46, 1, .1, 180);
  const materials: THREE.Material[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const keepMaterial = <T extends THREE.Material>(m: T): T => { materials.push(m); return m; };
  const keepGeometry = <T extends THREE.BufferGeometry>(g: T): T => { geometries.push(g); return g; };
  const blue = { value: 0 };
  const flare = { value: 0 };
  const warm = { value: .015 };

  const sky = new THREE.Mesh(
    keepGeometry(new THREE.PlaneGeometry(180, 100)),
    keepMaterial(new THREE.ShaderMaterial({
      vertexShader: skyVertex, fragmentShader: skyFragment,
      uniforms: { uBlue: blue }, depthWrite: false,
    })),
  );
  sky.position.set(0, 12, -76);
  scene.add(sky);

  const sun = new THREE.Mesh(
    keepGeometry(new THREE.PlaneGeometry(40, 40)),
    keepMaterial(new THREE.ShaderMaterial({
      vertexShader: skyVertex, fragmentShader: sunFragment,
      uniforms: { uBlue: blue, uFlare: flare }, transparent: true, depthWrite: false,
    })),
  );
  sun.position.set(-7, 15.8, -65);
  scene.add(sun);
  scene.fog = new THREE.FogExp2(0xeed0bb, .022);
  const ambient = new THREE.HemisphereLight(0xe7f2ff, 0xb39080, 2.6);
  const sunlight = new THREE.DirectionalLight(0xffe6c0, 3.1);
  sunlight.position.set(-15, 24, 15);
  scene.add(ambient, sunlight);

  const stone = keepMaterial(new THREE.MeshStandardMaterial({ color: 0xf3e7d8, roughness: .6, metalness: .12 }));
  const trim = keepMaterial(new THREE.MeshStandardMaterial({ color: 0xd7aa77, roughness: .3, metalness: .68 }));
  const edgeGlow = keepMaterial(new THREE.MeshBasicMaterial({ color: 0xffe3ad }));
  const box = keepGeometry(new THREE.BoxGeometry(1, 1, 1));
  const rounded = keepGeometry(new RoundedBoxGeometry(1, 1, 1, 2, .06));
  const cylinder = keepGeometry(new THREE.CylinderGeometry(.5, .5, 1, 24));
  const facadeMaterials = [0x729bae, 0xb59e95, 0x90b2c3, 0x597e95, 0xc4b39d, 0x92a1b7].map(color =>
    keepMaterial(new THREE.ShaderMaterial({
      vertexShader: facadeVertex, fragmentShader: facadeFragment,
      uniforms: { uTint: { value: new THREE.Color(color) }, uBlue: blue, uWarm: warm },
    })),
  );

  function block(x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, shape: THREE.BufferGeometry = box) {
    const mesh = new THREE.Mesh(shape, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    scene.add(mesh);
    return mesh;
  }

  // Canal-side terraces taper into the distance. The clear central axis
  // leaves the sun and horizon visible instead of filling the frame with boxes.
  block(-12, -.38, -19, 17, .75, 68, stone);
  block(12, -.38, -19, 17, .75, 68, stone);
  block(-3.55, .06, -18, .05, .04, 65, edgeGlow);
  block(3.55, .06, -18, .05, .04, 65, edgeGlow);

  // Authored skyline: a stepped spire, rounded glass towers, low terraces,
  // and offset slabs. A seeded generator supplies only the distant buildings.
  const towers = [
    [-5.8, 1, 2.5, 8.8, 2.7, 0], [6.4, -1, 2.7, 10.2, 3.1, 4],
    [-5.0, -6, 2, 12.5, 2.6, 2], [5.1, -9, 1.7, 7.6, 2.5, 1],
    [-7.7, -11, 2.6, 10.2, 3, 3], [8.7, -14, 2.6, 14.0, 3.5, 0],
    [-4.9, -18, 1.6, 8.6, 2.1, 1], [4.9, -20, 1.8, 15.6, 2.2, 2],
    [-10.3, -22, 3.1, 13, 3, 4], [8, -27, 2, 9.6, 2.7, 5],
    [-5.2, -29, 1.5, 12, 2, 0], [3, -34, 1.5, 10.2, 2, 1],
  ];
  towers.forEach(([x, z, w, h, d, tint], index) => {
    const material = facadeMaterials[tint];
    const shape = index === 2 || index === 5 ? cylinder : rounded;
    block(x, h / 2, z, w, h, d, material, shape);
    block(x, .3, z, w + .7, .6, d + .6, stone, rounded);
    if (index % 3 === 0) {
      block(x, h - 1, z, w + .07, .1, d + .07, trim);
      block(x, h + .05, z, w + .07, .1, d + .07, stone);
    }
    if (index === 7) {
      block(x, h + 1.25, z, w * .67, 2.5, d * .67, material, rounded);
      block(x, h + 3.3, z, w * .3, 1.8, d * .3, material, rounded);
      block(x, h + 5.1, z, .055, 2.4, .055, trim);
    }
    // A slim warm mullion anchors the front face of each main tower.
    if (shape !== cylinder) block(x - w * .37, h * .5, z + d * .5 + .012, .026, h, .018, trim);
  });

  let seed = 418;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 44; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (5 + random() * 22);
    const z = -26 - random() * 35;
    const h = 3 + random() * 11;
    block(x, h / 2, z, 1 + random() * 2.8, h, 1.5 + random() * 2, facadeMaterials[i % facadeMaterials.length]);
  }

  // Terrace foreground: pale stone, two low parapets and warm recessed strips.
  block(0, -.22, 11.9, 13, .45, 7, stone);
  block(0, -.30, 7.9, 8, .28, 1.1, stone);
  block(0, -.42, 7.1, 7.1, .22, .7, stone);
  block(-5.35, .34, 10.7, .22, .7, 7.8, stone);
  block(5.35, .34, 10.7, .22, .7, 7.8, stone);
  block(-5.35, .71, 10.7, .25, .025, 7.8, edgeGlow);
  block(5.35, .71, 10.7, .25, .025, 7.8, edgeGlow);

  const reflectionGeometry = keepGeometry(new THREE.PlaneGeometry(100, 130));
  const water = new Reflector(reflectionGeometry, {
    textureWidth: 640, textureHeight: 640,
    color: 0xa1b9c3, clipBias: .003,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -.12, -30);
  const waterMaterial = water.material as THREE.ShaderMaterial;
  waterMaterial.uniforms.uTime = { value: 0 };
  // Distort the reflection in surface coordinates; keeps the reflection real
  // while breaking its perfect mirror into slow, fine water ripples.
  waterMaterial.fragmentShader = waterMaterial.fragmentShader
    .replace("uniform sampler2D tDiffuse;", "uniform sampler2D tDiffuse;\nuniform float uTime;")
    .replace("texture2DProj( tDiffuse, vUv )", `texture2DProj( tDiffuse, vUv + vec4(
      sin(vUv.y * 145.0 + uTime * .6) * .0008 * vUv.w,
      sin(vUv.x * 70.0 + vUv.y * 195.0 + uTime * .4) * .0012 * vUv.w, 0., 0.) )`);
  scene.add(water);

  // A few slow points of light, deliberately sparse and small.
  const pointsGeometry = keepGeometry(new THREE.BufferGeometry());
  const points = new Float32Array(54);
  for (let i = 0; i < points.length; i += 3) {
    points[i] = (random() - .5) * 15;
    points[i + 1] = random() * 13 + 1;
    points[i + 2] = random() * 28 - 21;
  }
  pointsGeometry.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const pointsMaterial = keepMaterial(new THREE.PointsMaterial({ color: 0xffefcc, size: .037, transparent: true, opacity: .55, depthWrite: false }));
  const motes = new THREE.Points(pointsGeometry, pointsMaterial);
  scene.add(motes);

  const fogDay = new THREE.Color(0xeed0bb);
  const fogNight = new THREE.Color(0x8e96bc);
  const waterDay = new THREE.Color(0xa1b9c3);
  const waterNight = new THREE.Color(0x697caa);
  let mood = 0;

  return {
    camera,
    render({ time, delta, pointerX, pointerY, reveal, blueHour, activity, celebration }: {
      time: number; delta: number; pointerX: number; pointerY: number;
      reveal: number; blueHour: boolean; activity: number; celebration: number;
    }) {
      mood = THREE.MathUtils.lerp(mood, blueHour ? 1 : 0, delta === 0 ? 1 : 1 - Math.exp(-delta * 2.4));
      blue.value = mood;
      flare.value = celebration;
      warm.value = .015 + activity * .035;
      (scene.fog as THREE.FogExp2).color.lerpColors(fogDay, fogNight, mood);
      (scene.background as THREE.Color).copy((scene.fog as THREE.FogExp2).color);
      (waterMaterial.uniforms.color.value as THREE.Color).lerpColors(waterDay, waterNight, mood);
      waterMaterial.uniforms.uTime.value = time;
      ambient.intensity = 2.6 - mood * 1.3;
      sunlight.intensity = 3.1 - mood * 2.2 + celebration * .6;
      camera.position.set(pointerX * .65, 4.2 + pointerY * .25, 18.5 + (1 - reveal) * 3.5);
      camera.lookAt(pointerX * -.5, 5.7 + pointerY * .12, -17);
      motes.position.y = Math.sin(time * .12) * .3;
      renderer.render(scene, camera);
    },
    dispose() {
      water.dispose();
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      scene.clear();
    },
  };
}
