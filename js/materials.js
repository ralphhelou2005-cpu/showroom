import * as THREE from 'three';

const V2 = (x, y = x) => new THREE.Vector2(x, y);

// userData.tile = metres covered by one texture repeat; Showroom.box() scales UVs from it.
export function createMaterials(lib) {
  const T = lib.sets;
  const textured = (set, params, tile) => {
    const m = new THREE.MeshPhysicalMaterial({ map: T[set].map, roughnessMap: T[set].rough, normalMap: T[set].normal, roughness: 1, metalness: 0, ...params });
    m.userData.tile = tile;
    return m;
  };
  const metal = (color, tile = 1, rough = 1, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: rough, roughnessMap: T.brushed.rough, normalMap: T.brushed.normal, normalScale: V2(0.4), ...extra });
    m.userData.tile = tile;
    return m;
  };
  const m = {};

  m.floor = new THREE.MeshPhysicalMaterial({ map: T.floor.map, roughnessMap: T.floor.rough, normalMap: T.floor.normal, normalScale: V2(0.6), roughness: 1, metalness: 0, clearcoat: 0.38, clearcoatRoughness: 0.1, specularIntensity: 0.7 });
  m.counter = textured('counter', { normalScale: V2(0.3), clearcoat: 0.55, clearcoatRoughness: 0.14 }, 2.4);
  m.darkstone = textured('darkstone', { normalScale: V2(0.3), clearcoat: 0.45, clearcoatRoughness: 0.2 }, 2.4);
  m.concrete = textured('concrete', { color: '#c9c4b8', normalScale: V2(0.8) }, 2.4);
  m.concreteDark = textured('concrete', { color: '#4a4b49', normalScale: V2(0.8) }, 2.4);
  m.ceiling = textured('concrete', { color: '#b4aea2', normalScale: V2(0.6) }, 3.2);
  m.board = textured('board', { color: '#a9a396', normalScale: V2(0.9) }, 2.2);
  m.wood = textured('wood', { clearcoat: 0.14, clearcoatRoughness: 0.4, normalScale: V2(0.6) }, 1.4);
  m.steel = metal('#d6d2c7', 1, 1);
  m.darkSteel = metal('#34373a', 1, 1);
  m.brass = metal('#d9c597', 1, 0.7);
  m.chrome = new THREE.MeshStandardMaterial({ color: '#e2e2de', metalness: 1, roughness: 0.08 });
  m.column = new THREE.MeshStandardMaterial({ color: '#d9d5c9', metalness: 1, roughness: 0.3 });
  m.leather = textured('leather', { color: '#5d554b', normalScale: V2(0.9), sheen: 0.35, sheenRoughness: 0.5, sheenColor: new THREE.Color('#8c8070'), clearcoat: 0.08, clearcoatRoughness: 0.5 }, 0.5);
  m.leatherCognac = textured('leather', { color: '#a0653a', normalScale: V2(0.9), sheen: 0.3, sheenRoughness: 0.5, sheenColor: new THREE.Color('#c58a5c'), clearcoat: 0.08, clearcoatRoughness: 0.5 }, 0.5);
  m.fabric = textured('fabric', { color: '#958e80', normalScale: V2(0.8), sheen: 1, sheenRoughness: 0.8, sheenColor: new THREE.Color('#c4bfb2') }, 0.6);
  m.rug = textured('fabric', { color: '#b9b09d', normalScale: V2(1.3), sheen: 0.8, sheenRoughness: 0.9, sheenColor: new THREE.Color('#d6d0c1') }, 0.5);
  m.rugEdge = textured('fabric', { color: '#756f63', normalScale: V2(1.3), sheen: 0.8, sheenRoughness: 0.9, sheenColor: new THREE.Color('#aaa493') }, 0.5);
  m.bark = textured('concrete', { color: '#4a3a2d', normalScale: V2(1.1) }, 0.6);
  m.soil = textured('soil', { normalScale: V2(1) }, 0.3);
  m.ceramicDark = new THREE.MeshPhysicalMaterial({ color: '#1f2221', roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
  m.ceramicWhite = new THREE.MeshPhysicalMaterial({ color: '#e6e2d8', roughness: 0.3, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  m.terracotta = new THREE.MeshStandardMaterial({ color: '#9b5738', roughness: 0.88, metalness: 0, roughnessMap: T.concrete.rough, normalMap: T.concrete.normal, normalScale: V2(0.7) });
  m.pebble = new THREE.MeshStandardMaterial({ color: '#8d8a82', roughness: 0.7, metalness: 0 });
  m.paving = textured('paving', { normalScale: V2(0.5) }, 12);
  m.asphalt = textured('concrete', { color: '#6a6c6e', normalScale: V2(0.9) }, 5);
  m.sidewalk = textured('concrete', { color: '#d9d4c8', normalScale: V2(0.7) }, 3);

  m.glass = new THREE.MeshPhysicalMaterial({ color: '#a9c0c0', metalness: 0, roughness: 0.03, transparent: true, opacity: 0.2, ior: 1.5, envMapIntensity: 2.8, side: THREE.DoubleSide, depthWrite: false });
  m.doorGlass = new THREE.MeshPhysicalMaterial({ color: '#b6cbc9', metalness: 0, roughness: 0.02, transparent: true, opacity: 0.24, ior: 1.5, envMapIntensity: 3.2, side: THREE.DoubleSide, depthWrite: false });
  m.smoked = new THREE.MeshPhysicalMaterial({ color: '#2a2e2d', metalness: 0, roughness: 0.06, transparent: true, opacity: 0.62, envMapIntensity: 2, clearcoat: 1, clearcoatRoughness: 0.04 });

  const led = (color, emissive, intensity) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: 0.4, metalness: 0 });
  m.ledWarm = led('#fff1da', '#ffd49a', 2.4);
  m.ledSoft = led('#fff1da', '#ffcf94', 1.3);
  m.ledCool = led('#e3eeff', '#b7d2ff', 1.6);
  m.lampShade = new THREE.MeshStandardMaterial({ color: '#f1e8d6', emissive: '#f0cf9c', emissiveIntensity: 0.6, roughness: 0.9, side: THREE.DoubleSide });
  m.paper = new THREE.MeshStandardMaterial({ color: '#d9d4c7', roughness: 0.85 });
  return m;
}
