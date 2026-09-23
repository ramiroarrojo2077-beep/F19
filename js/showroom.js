// Garaje: estudio 3D con el auto del jugador girando sobre una plataforma.
import * as THREE from 'three';
import { buildCarModel } from './car.js';

export class Showroom {
  constructor() {
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x07080b);
    scene.fog = new THREE.Fog(0x07080b, 12, 34);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.t = 0;

    // piso reflectante oscuro con aro luminoso
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.25, metalness: 0.6 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.3, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x15181e, roughness: 0.3, metalness: 0.7 }));
    disc.position.y = 0.04;
    disc.receiveShadow = true;
    scene.add(disc);
    this.turntable = new THREE.Group();
    this.turntable.position.y = 0.08;
    scene.add(this.turntable);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.25, 0.03, 8, 96), new THREE.MeshBasicMaterial({ color: 0xe10600 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.09;
    scene.add(ring);
    this.ring = ring;

    // tiras de luz en el techo (se ven reflejadas en la pintura)
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3) });
    for (let k = -2; k <= 2; k++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 9), stripMat);
      s.position.set(k * 1.6, 7, 0);
      scene.add(s);
    }

    const key = new THREE.SpotLight(0xffffff, 260, 30, 0.55, 0.5, 1.4);
    key.position.set(5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    scene.add(key, key.target);
    const rim = new THREE.SpotLight(0x8fb8ff, 160, 30, 0.6, 0.6, 1.4);
    rim.position.set(-6, 5, -7);
    scene.add(rim, rim.target);
    const warm = new THREE.SpotLight(0xffc28a, 90, 25, 0.7, 0.7, 1.4);
    warm.position.set(-4, 3, 7);
    scene.add(warm, warm.target);
    scene.add(new THREE.HemisphereLight(0x9fb3cc, 0x101010, 0.35));
    this.car = null;
  }

  setEnvironment(tex) {
    this.scene.environment = tex;
    this.scene.environmentIntensity = 0.55;
  }

  setCar(team, number) {
    if (this.car) {
      this.turntable.remove(this.car.root);
      if (this.car.numMat) { this.car.numMat.map && this.car.numMat.map.dispose(); this.car.numMat.dispose(); }
    }
    this.car = buildCarModel(team, number);
    this.car.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.turntable.add(this.car.root);
    this.ring.material.color.set(team.primary);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt, wide) {
    this.t += dt;
    this.turntable.rotation.y = this.t * 0.35;
    if (this.car) for (const w of this.car.wheels) w.spin.rotation.x = 0;
    const a = -0.6 + Math.sin(this.t * 0.2) * 0.25;
    const r = wide ? 11 : 13;
    // en pantallas anchas se corre el auto a la derecha del panel del menú
    const off = wide ? -2.2 : 0;
    const c = this.camera;
    c.position.set(Math.sin(a) * r + Math.cos(a) * off, 2.6 + Math.sin(this.t * 0.3) * 0.3, Math.cos(a) * r - Math.sin(a) * off);
    c.lookAt(Math.cos(a) * off, 0.55, -Math.sin(a) * off);
  }
}
