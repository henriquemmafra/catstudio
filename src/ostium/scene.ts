/**
 * Mapa coronário 3D esquemático (não é a anatomia do paciente): coração-fantasma, raiz da aorta e
 * árvore coronária em tubos. Renderiza sob demanda, para não gastar CPU em PC fraco.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SEG_RANGE, isSegmented, span } from './anatomy';

export type Dom = 'direita' | 'esquerda' | 'codominante';
export interface SceneBranch {
  id: string;
  kind: 'diagonal' | 'marginal' | 'diagonalis' | 'dp' | 'vp';
  index: number;
  parent: string;
  label: string;
}
export interface ScenePlaque {
  id: string;
  vessel: string;
  t: number;
  len: number;
  color: string;
  abbr: string;
}
export interface SceneModel {
  dominance: Dom;
  branches: SceneBranch[];
  ghosts: {
    kind: SceneBranch['kind'];
    index: number;
    parent: string;
    label: string;
  }[];
  plaques: ScenePlaque[];
  /** chaves: 'DA.proximal', 'TCE', id do ramo */
  limited: Set<string>;
  cursor: { vessel: string; t: number } | null;
  selectedPlaque: string | null;
}
export type Pick =
  | { kind: 'vessel'; vessel: string; t: number }
  | { kind: 'plaque'; id: string }
  | { kind: 'ghost'; branchKind: SceneBranch['kind'] };

const V = THREE.Vector3;
const AXIS = new V(0.45, -0.8, 0.4).normalize();
const E1 = new V(0, 0, 1).addScaledVector(AXIS, -AXIS.z).normalize(); // sulco interventricular anterior
const E2 = new V().crossVectors(E1, AXIS).normalize(); // lado esquerdo do paciente
const R = 2.3,
  H = 4.4;
const BASE = AXIS.clone().multiplyScalar(-H * 0.4);
const radiusAt = (u: number) =>
  u < 0
    ? R * Math.sqrt(Math.max(0, 1 - (u / 0.45) ** 2))
    : R * Math.sqrt(Math.max(0, 1 - u * u));
/** Ponto na superfície do coração: u = 0 no sulco AV, 1 no ápice; ângulo 0 = anterior, + = esquerda. */
function P(u: number, deg: number, k = 1.035) {
  const a = (deg * Math.PI) / 180,
    r = radiusAt(u) * k;
  return BASE.clone()
    .addScaledVector(AXIS, u * H)
    .addScaledVector(E1, Math.cos(a) * r)
    .addScaledVector(E2, Math.sin(a) * r);
}
const AO = P(-0.1, -8, 0.3);
const AO_DIR = new V(-0.15, 1, -0.1).normalize();
const BIF = P(0.03, 22);
const curve = (pts: THREE.Vector3[]) =>
  new THREE.CatmullRomCurve3(pts, false, 'centripetal');
function ostium(toward: THREE.Vector3) {
  const d = toward.clone().sub(AO);
  d.addScaledVector(AO_DIR, -d.dot(AO_DIR)).normalize();
  return AO.clone().addScaledVector(d, 0.44).addScaledVector(AO_DIR, 0.15);
}

function mainCurves(dom: Dom): Record<string, THREE.Curve<THREE.Vector3>> {
  const cdEnd =
    dom === 'esquerda'
      ? [-45, -75, -105, -130, -150]
      : [-45, -75, -105, -135, -160, -180];
  const cxEnd =
    dom === 'esquerda' ? [45, 75, 105, 135, 160, 180] : [45, 75, 105, 130, 150];
  return {
    TCE: curve([
      ostium(BIF),
      ostium(BIF).lerp(BIF, 0.55).addScaledVector(AXIS, -0.05),
      BIF,
    ]),
    DA: curve([
      BIF,
      P(0.13, 9),
      P(0.3, 4),
      P(0.5, 2),
      P(0.7, 2),
      P(0.88, 3),
      P(0.985, 6),
    ]),
    CX: curve([
      BIF,
      ...cxEnd.map((d, i) => P(0.04 + Math.min(i, 2) * 0.01, d)),
    ]),
    CD: curve([
      ostium(P(0.04, -45)),
      ...cdEnd.map((d, i) => P(0.04 + Math.min(i, 2) * 0.01, d)),
    ]),
  };
}
function branchCurve(
  kind: SceneBranch['kind'],
  index: number,
  parent: string,
  mains: Record<string, THREE.Curve<THREE.Vector3>>
): THREE.Curve<THREE.Vector3> | null {
  if (kind === 'diagonal') {
    const def = [
      [
        0.2,
        [
          [0.3, 20],
          [0.42, 36],
          [0.55, 46],
        ],
      ],
      [
        0.42,
        [
          [0.5, 18],
          [0.62, 32],
          [0.74, 40],
        ],
      ],
      [
        0.6,
        [
          [0.68, 16],
          [0.78, 28],
          [0.88, 34],
        ],
      ],
    ] as const;
    const d = def[index];
    if (!d) return null;
    return curve([mains.DA!.getPoint(d[0]), ...d[1].map(([u, a]) => P(u, a))]);
  }
  if (kind === 'marginal') {
    const def = [
      [
        [0.05, 76],
        [0.2, 82],
        [0.38, 86],
        [0.56, 88],
      ],
      [
        [0.06, 104],
        [0.2, 108],
        [0.38, 110],
        [0.55, 110],
      ],
      [
        [0.06, 130],
        [0.2, 132],
        [0.36, 132],
        [0.5, 130],
      ],
    ] as const;
    const d = def[index];
    if (!d) return null;
    return curve(d.map(([u, a]) => P(u, a)));
  }
  if (kind === 'diagonalis')
    return index ? null : curve([BIF, P(0.12, 31), P(0.26, 43), P(0.42, 53)]);
  if (index) return null;
  if (kind === 'dp')
    return curve([P(0.06, 180), P(0.25, 180), P(0.5, 180), P(0.76, 180)]);
  return parent === 'CD'
    ? curve([P(0.06, 180), P(0.1, 166), P(0.22, 153), P(0.4, 148)])
    : curve([P(0.06, 150), P(0.18, 155), P(0.34, 157)]);
}

class Sub extends THREE.Curve<THREE.Vector3> {
  constructor(
    private base: THREE.Curve<THREE.Vector3>,
    private a: number,
    private b: number
  ) {
    super();
  }

  getPoint(u: number, target = new V()) {
    return this.base.getPoint(this.a + (this.b - this.a) * u, target);
  }
}

export interface CoronaryScene {
  update(m: SceneModel): void;
  highlight(keys: string[]): void;
  view(name: 'anterior' | 'esquerda' | 'direita' | 'posterior'): void;
  resize(): void;
}

export function createScene(
  canvas: HTMLCanvasElement,
  labelBox: HTMLElement,
  onPick: (p: Pick) => void
): CoronaryScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'default',
    });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const bg = document.createElement('canvas');
  bg.width = bg.height = 256;
  const g2 = bg.getContext('2d')!;
  const gr = g2.createRadialGradient(128, 104, 0, 128, 128, 190);
  gr.addColorStop(0, '#15386e');
  gr.addColorStop(0.42, '#0a2048');
  gr.addColorStop(1, '#030a1a');
  g2.fillStyle = gr;
  g2.fillRect(0, 0, 256, 256);
  const bgTex = new THREE.CanvasTexture(bg);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = bgTex;
  scene.fog = new THREE.Fog(0x081a38, 18, 44);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0.6, 1.4, 17.5);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = 28;
  controls.rotateSpeed = 0.9;
  controls.target.set(0, 0.35, 0);
  controls.update();

  scene.add(new THREE.HemisphereLight(0xb3d0ff, 0x0b1a3a, 1.5));
  const key = new THREE.DirectionalLight(0xfff3e0, 2.4);
  key.position.set(5, 9, 10);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fa8ff, 1.1);
  rim.position.set(-8, -3, -8);
  scene.add(rim);

  // coração-fantasma e aorta (fixos)
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 48; i++) {
    const u = -0.45 + (1.45 * i) / 48;
    prof.push(new THREE.Vector2(Math.max(radiusAt(u), 0.001), -u * H));
  }
  const heart = new THREE.Mesh(
    new THREE.LatheGeometry(prof, 56),
    new THREE.MeshPhysicalMaterial({
      color: 0x2c5596,
      roughness: 0.55,
      clearcoat: 0.3,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  heart.quaternion.setFromUnitVectors(new V(0, -1, 0), AXIS);
  heart.position.copy(BASE);
  heart.renderOrder = -1;
  scene.add(heart);
  const aorta = new THREE.Mesh(
    new THREE.TubeGeometry(
      curve([
        AO.clone().addScaledVector(AO_DIR, -0.5),
        AO,
        AO.clone().addScaledVector(AO_DIR, 1.3),
        AO.clone()
          .addScaledVector(AO_DIR, 2.3)
          .add(new V(-0.35, 0, -0.25)),
      ]),
      24,
      0.44,
      24,
      false
    ),
    new THREE.MeshPhysicalMaterial({
      color: 0xcfc6ad,
      roughness: 0.5,
      clearcoat: 0.3,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    })
  );
  scene.add(aorta);

  const tree = new THREE.Group();
  scene.add(tree);
  let pickables: THREE.Mesh[] = [];
  let lit: { key: string; mat: THREE.MeshPhysicalMaterial; base: number }[] =
    [];
  let labels: { el: HTMLElement; pos: THREE.Vector3 }[] = [];
  let curves: Record<string, THREE.Curve<THREE.Vector3>> = {};
  let samples: Record<string, THREE.Vector3[]> = {};
  let needs = true;
  const request = () => {
    needs = true;
  };

  const vesselMat = (limited: boolean) =>
    new THREE.MeshPhysicalMaterial({
      color: limited ? 0x8fa0b8 : 0xf2ead3,
      roughness: 0.42,
      clearcoat: 0.4,
      emissive: limited ? 0x8fa0b8 : 0xf2ead3,
      emissiveIntensity: 0.05,
      transparent: limited,
      opacity: limited ? 0.36 : 1,
    });

  function addLabel(
    text: string,
    pos: THREE.Vector3,
    cls = '',
    color?: string
  ) {
    const el = document.createElement('div');
    el.className = `lab3 ${cls}`;
    el.textContent = text;
    if (color) {
      el.style.color = color;
      el.style.borderColor = color;
    }
    labelBox.append(el);
    labels.push({ el, pos });
  }
  function tube(
    c: THREE.Curve<THREE.Vector3>,
    r: number,
    mat: THREE.Material,
    data?: any,
    seg = 28
  ) {
    const m = new THREE.Mesh(new THREE.TubeGeometry(c, seg, r, 12, false), mat);
    if (data) {
      m.userData = data;
      pickables.push(m);
    }
    tree.add(m);
    return m;
  }
  const cap = (p: THREE.Vector3, r: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
    m.position.copy(p);
    tree.add(m);
  };

  function update(m: SceneModel) {
    tree.traverse((o) => {
      const me = o as THREE.Mesh;
      if (me.geometry) me.geometry.dispose();
      if (me.material) (me.material as THREE.Material).dispose();
    });
    tree.clear();
    pickables = [];
    lit = [];
    labels = [];
    labelBox.replaceChildren();
    const mains = mainCurves(m.dominance);
    curves = { ...mains };
    const radius: Record<string, number> = {
      TCE: 0.125,
      DA: 0.1,
      CX: 0.1,
      CD: 0.1,
    };

    for (const id of ['TCE', 'DA', 'CX', 'CD']) {
      const c = mains[id]!;
      if (isSegmented(id)) {
        for (const [sname, [a, b]] of Object.entries(SEG_RANGE[id])) {
          const lim = m.limited.has(`${id}.${sname}`);
          const mat = vesselMat(lim);
          tube(new Sub(c, a, b), radius[id]!, mat, { vessel: id });
          lit.push({ key: id, mat, base: 0.05 });
          if (lim) addLabel('lim', c.getPoint((a + b) / 2), 'badge', '#aab7c9');
          if (a > 0) {
            const ring = new THREE.Mesh(
              new THREE.TorusGeometry(radius[id]! * 1.5, 0.018, 8, 24),
              new THREE.MeshBasicMaterial({ color: 0x7891b5 })
            );
            ring.position.copy(c.getPoint(a));
            ring.quaternion.setFromUnitVectors(new V(0, 0, 1), c.getTangent(a));
            tree.add(ring);
          }
        }
      } else {
        const lim = m.limited.has(id);
        const mat = vesselMat(lim);
        tube(c, radius[id]!, mat, { vessel: id }, 12);
        lit.push({ key: id, mat, base: 0.05 });
        if (lim) addLabel('lim', c.getPoint(0.5), 'badge', '#aab7c9');
      }
      cap(c.getPoint(1), radius[id]!, vesselMat(false));
    }
    addLabel('TCE', mains.TCE!.getPoint(0.4).add(new V(0, 0.42, 0)), 'name');
    addLabel('DA', mains.DA!.getPoint(0.5).add(new V(-0.45, 0, 0.1)), 'name');
    addLabel('CX', mains.CX!.getPoint(0.3).add(new V(0.2, 0.42, 0)), 'name');
    addLabel('CD', mains.CD!.getPoint(0.42).add(new V(-0.5, 0, 0)), 'name');
    addLabel('Ao', AO.clone().addScaledVector(AO_DIR, 2.1), 'name dim');

    for (const b of m.branches) {
      const c = branchCurve(b.kind, b.index, b.parent, mains);
      if (!c) continue;
      curves[b.id] = c;
      radius[b.id] = 0.07;
      const lim = m.limited.has(b.id);
      const mat = vesselMat(lim);
      tube(c, 0.07, mat, { vessel: b.id }, 20);
      lit.push({ key: b.id, mat, base: 0.05 });
      cap(c.getPoint(1), 0.07, vesselMat(lim));
      addLabel(
        b.label,
        c.getPoint(1).add(c.getTangent(1).multiplyScalar(0.3)),
        'small'
      );
      if (lim) addLabel('lim', c.getPoint(0.5), 'badge', '#aab7c9');
    }
    for (const gst of m.ghosts) {
      const c = branchCurve(gst.kind, gst.index, gst.parent, mains);
      if (!c) continue;
      tube(
        c,
        0.045,
        new THREE.MeshBasicMaterial({
          color: 0x7891b5,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        }),
        { ghost: gst.kind },
        16
      );
      addLabel(
        `+ ${gst.label}`,
        c.getPoint(1).add(c.getTangent(1).multiplyScalar(0.3)),
        'ghost'
      );
    }
    for (const p of m.plaques) {
      const c = curves[p.vessel];
      if (!c) continue;
      const [a, b] = span(p.t, p.len);
      const col = new THREE.Color(p.color);
      const mat = new THREE.MeshPhysicalMaterial({
        color: col,
        roughness: 0.35,
        clearcoat: 0.5,
        emissive: col,
        emissiveIntensity: 0.35,
      });
      tube(
        new Sub(c, a, b),
        radius[p.vessel]! * 1.75,
        mat,
        { plaque: p.id },
        14
      );
      lit.push({ key: p.id, mat, base: 0.35 });
      cap(c.getPoint(a), radius[p.vessel]! * 1.75, mat.clone());
      cap(c.getPoint(b), radius[p.vessel]! * 1.75, mat.clone());
      if (m.selectedPlaque === p.id)
        tube(
          new Sub(c, a, b),
          radius[p.vessel]! * 2.6,
          new THREE.MeshBasicMaterial({
            color: 0xf2ead3,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
          undefined,
          14
        );
      addLabel(p.abbr, c.getPoint((a + b) / 2), 'badge', p.color);
    }
    if (m.cursor && curves[m.cursor.vessel]) {
      const c = curves[m.cursor.vessel]!;
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(
          (radius[m.cursor.vessel] ?? 0.1) * 2.3,
          0.035,
          10,
          32
        ),
        new THREE.MeshBasicMaterial({ color: 0xf2ead3 })
      );
      ring.position.copy(c.getPoint(m.cursor.t));
      ring.quaternion.setFromUnitVectors(
        new V(0, 0, 1),
        c.getTangent(m.cursor.t)
      );
      tree.add(ring);
    }
    samples = {};
    request();
  }

  function nearestT(vessel: string, p: THREE.Vector3) {
    const c = curves[vessel];
    if (!c) return 0.5;
    const pts = (samples[vessel] ??= Array.from({ length: 201 }, (_, i) =>
      c.getPoint(i / 200)
    ));
    let best = 0,
      bd = Infinity;
    pts.forEach((q, i) => {
      const d = q.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best / 200;
  }

  // clique (sem arrastar) = marcar
  const ray = new THREE.Raycaster();
  let down: [number, number] | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5)
      return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      ),
      camera
    );
    const hit = ray
      .intersectObjects(pickables, false)
      .sort(
        (a, b) =>
          Number(!!b.object.userData.plaque) -
            Number(!!a.object.userData.plaque) || a.distance - b.distance
      )[0];
    if (!hit) return;
    const d = hit.object.userData;
    if (d.plaque) onPick({ kind: 'plaque', id: d.plaque });
    else if (d.ghost) onPick({ kind: 'ghost', branchKind: d.ghost });
    else
      onPick({
        kind: 'vessel',
        vessel: d.vessel,
        t: nearestT(d.vessel, hit.point),
      });
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      ),
      camera
    );
    canvas.style.cursor = ray.intersectObjects(pickables, false).length
      ? 'crosshair'
      : 'grab';
  });
  controls.addEventListener('change', request);

  function resize() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    request();
  }
  new ResizeObserver(resize).observe(canvas);

  const tmp = new V();
  function frame() {
    requestAnimationFrame(frame);
    if (!needs) return;
    needs = false;
    renderer.render(scene, camera);
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    for (const l of labels) {
      tmp.copy(l.pos).project(camera);
      l.el.style.transform = `translate(-50%,-50%) translate(${((tmp.x + 1) / 2) * w}px,${((1 - tmp.y) / 2) * h}px)`;
      l.el.style.display = tmp.z < 1 ? '' : 'none';
    }
  }
  resize();
  frame();

  return {
    update,
    highlight(keys) {
      for (const l of lit)
        l.mat.emissiveIntensity = keys.includes(l.key) ? 0.75 : l.base;
      request();
    },
    view(name) {
      const pos = {
        anterior: [0.6, 1.4, 17.5],
        esquerda: [16.5, 2, 5],
        direita: [-16.5, 2, 5],
        posterior: [-4, -6, -16],
      }[name];
      camera.position.set(pos[0]!, pos[1]!, pos[2]!);
      controls.target.set(0, 0.35, 0);
      controls.update();
      request();
    },
    resize,
  };
}
