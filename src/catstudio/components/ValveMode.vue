<script setup lang="ts">
/**
 * CatStudio — modo Valvas: a valva aórtica é localizada sozinha (as outras,
 * por três pontos do anel no corte axial) e aparece como holograma ou
 * reconstrução 3D; com várias fases, batendo.
 */
import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { valveMode } from '@/src/catstudio/valveMode';
import {
  VALVES,
  bloodLevel,
  defaultThresholds,
  extractSurface,
  planeFromPoints,
  sampleCube,
  type Cube,
  type Plane,
  type ValveKey,
  type ValveMesh,
  type Vec3,
  type Volume,
} from '@/src/catstudio/valve';
import {
  createValveRenderer,
  turnOnAxis,
  turnOnScreen,
  viewMatrix,
} from '@/src/catstudio/valveRender';
import {
  detectAorticValve,
  orientPlane,
  planeAt,
  tiltPlane,
} from '@/src/catstudio/valveDetect';
import { pinImage, unpinImage } from '@/src/catstudio/lazy';
import { untilLoaded } from '@/src/composables/untilLoaded';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';

const SIZE = 640;
const imageCache = useImageCacheStore();
const { currentImageID, currentImageData } = useCurrentImage();

const valve = ref<ValveKey>('aortica');
const points = ref<Vec3[]>([]);
const slice = ref(0);
const zoom = reactive({ k: 1, cx: 0.5, cy: 0.5 });
const style = ref<'holo' | 'solid'>('holo');
const autoSpin = ref(true);
const playing = ref(true);
const radius = ref(VALVES.aortica.radius);
const threshold = ref(250);
const message = ref('');
const busy = ref('');
const recording = ref(false);

const cubes = shallowRef<Cube[]>([]);
const frames = shallowRef<ValveMesh[]>([]);
/** Anel em uso (achado sozinho ou marcado por três pontos), antes de inclinar. */
const ring = shallowRef<Plane | null>(null);
const ringAuto = ref(false);
/** Inclinação do anel, em graus, nos dois eixos do seu plano. */
const lean = reactive({ a: 0, b: 0 });
/** Faixa reconstruída ao longo do eixo da valva (mm a partir do anel). */
const span = ref<[number, number]>([
  -VALVES.aortica.below,
  VALVES.aortica.above,
]);
/** Corte da frente: mm retirados do lado do observador. */
const cut = ref(0);
const CUT_REACH = 40;
/** Pedaços soltos menores que isto (mm² de superfície) são retirados. */
const dust = ref(60);
const phase = ref(0);
/** Giro livre: matriz do sistema do anel para a tela. */
const START_VIEW = viewMatrix(0.6, 0.95);
let rot = START_VIEW;
/** Forma da região reconstruída em volta do centro. */
const shape = ref<'cylinder' | 'sphere'>('cylinder');
/** Marcação à mão: um clique no centro, ou três pontos do anel. */
const pickMode = ref<'center' | 'three'>('center');

const pickCanvas = ref<HTMLCanvasElement | null>(null);
const viewCanvas = ref<HTMLCanvasElement | null>(null);
const renderer = createValveRenderer(SIZE, SIZE);

function volumeOf(id: string | null | undefined): Volume | null {
  const img = imageCache.getVtkImageData(id);
  const scalars = img?.getPointData().getScalars();
  if (!img || !scalars || scalars.getNumberOfComponents() !== 1) return null;
  return {
    data: scalars.getData() as ArrayLike<number>,
    dims: img.getDimensions() as Vec3,
    spacing: img.getSpacing() as Vec3,
  };
}
const volume = computed(() =>
  valveMode.open && currentImageData.value
    ? volumeOf(currentImageID.value)
    : null
);
const direction = computed(
  () => imageCache.getVtkImageData(currentImageID.value)?.getDirection() ?? null
);

/** Outras fases da mesma série (volumes "id~2", "id~3"...), em ordem. */
const phaseIds = computed(() => {
  const id = currentImageID.value;
  if (!id) return [];
  const base = id.split('~')[0];
  return imageCache.imageIds
    .filter((x) => x.split('~')[0] === base)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
});

// ------------------------------------------------------------ corte axial

const offscreen = document.createElement('canvas');

function paintSlice(vol: Volume) {
  const [nx, ny] = vol.dims;
  offscreen.width = nx;
  offscreen.height = ny;
  const ctx = offscreen.getContext('2d')!;
  const img = ctx.createImageData(nx, ny);
  const base = nx * ny * slice.value;
  for (let i = 0; i < nx * ny; i++) {
    const g = ((vol.data[base + i] + 100) / 800) * 255;
    img.data[4 * i] = g;
    img.data[4 * i + 1] = g;
    img.data[4 * i + 2] = g;
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** Retângulo do corte que aparece na tela (em pixels do corte). */
function visibleRect(vol: Volume) {
  const w = vol.dims[0] / zoom.k;
  const h = vol.dims[1] / zoom.k;
  const x = Math.max(
    0,
    Math.min(vol.dims[0] - w, zoom.cx * vol.dims[0] - w / 2)
  );
  const y = Math.max(
    0,
    Math.min(vol.dims[1] - h, zoom.cy * vol.dims[1] - h / 2)
  );
  return { x, y, w, h };
}

function drawPick() {
  const cv = pickCanvas.value;
  const vol = volume.value;
  if (!cv || !vol) return;
  paintSlice(vol);
  const ctx = cv.getContext('2d')!;
  const r = visibleRect(vol);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreen, r.x, r.y, r.w, r.h, 0, 0, cv.width, cv.height);
  points.value.forEach((p, n) => {
    const x = ((p[0] / vol.spacing[0] - r.x) / r.w) * cv.width;
    const y = ((p[1] / vol.spacing[1] - r.y) / r.h) * cv.height;
    const here = Math.abs(p[2] / vol.spacing[2] - slice.value) < 1.5;
    ctx.strokeStyle = here ? '#ffd24a' : 'rgba(255,210,74,.45)';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.font = '600 16px sans-serif';
    ctx.fillText(String(n + 1), x + 12, y - 9);
  });
  const found = plane.value;
  if (found) {
    const c = found.center;
    const x = ((c[0] / vol.spacing[0] - r.x) / r.w) * cv.width;
    const y = ((c[1] / vol.spacing[1] - r.y) / r.h) * cv.height;
    const here = Math.abs(c[2] / vol.spacing[2] - slice.value) < 1.5;
    ctx.strokeStyle = here ? '#ffd24a' : 'rgba(255,210,74,.6)';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3;
    ctx.setLineDash(here ? [] : [10, 7]);
    ctx.beginPath();
    ctx.arc(
      x,
      y,
      (radius.value / vol.spacing[0] / r.w) * cv.width,
      0,
      2 * Math.PI
    );
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = '600 15px sans-serif';
    ctx.fillText(here ? 'anel' : 'anel (em outro corte)', x + 10, y - 9);
  }
}

function toSlicePixel(e: MouseEvent, vol: Volume) {
  const box = pickCanvas.value!.getBoundingClientRect();
  const r = visibleRect(vol);
  return {
    i: r.x + ((e.clientX - box.left) / box.width) * r.w,
    j: r.y + ((e.clientY - box.top) / box.height) * r.h,
  };
}

/** Arrastando o anel no corte (só redesenha; a valva é refeita ao soltar). */
let ringDrag = false;

function onPickDown(e: PointerEvent) {
  const vol = volume.value;
  const now = plane.value;
  if (!vol || !now) return;
  const { i, j } = toSlicePixel(e, vol);
  const dx = i * vol.spacing[0] - now.center[0];
  const dy = j * vol.spacing[1] - now.center[1];
  if (Math.hypot(dx, dy) > radius.value) return;
  ringDrag = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function onPickMove(e: PointerEvent) {
  const vol = volume.value;
  if (!ringDrag || !vol || !ring.value) return;
  const { i, j } = toSlicePixel(e, vol);
  // o anel vem para o corte que está na tela
  ring.value = {
    ...ring.value,
    center: [
      i * vol.spacing[0],
      j * vol.spacing[1],
      slice.value * vol.spacing[2],
    ],
  };
}

function addPoint(e: PointerEvent, vol: Volume) {
  const { i, j } = toSlicePixel(e, vol);
  if (pickMode.value === 'center') {
    // um clique = centro; o plano começa axial e é ajustado nos controles
    const center: Vec3 = [
      i * vol.spacing[0],
      j * vol.spacing[1],
      slice.value * vol.spacing[2],
    ];
    ring.value = orientPlane(
      planeAt(center, [0, 0, 1]),
      valve.value,
      direction.value
    );
    ringAuto.value = false;
    buildCurrent();
    return;
  }
  points.value = [
    ...points.value,
    [i * vol.spacing[0], j * vol.spacing[1], slice.value * vol.spacing[2]],
  ];
  if (points.value.length < 3) return;
  const marked = planeFromPoints(
    points.value[0],
    points.value[1],
    points.value[2]
  );
  if (!marked) {
    message.value = 'Os três pontos estão alinhados. Refaça os pontos.';
    return;
  }
  // a ordem dos cliques não pode decidir de que lado ficam as cúspides
  ring.value = orientPlane(marked, valve.value, direction.value);
  ringAuto.value = false;
  buildCurrent();
}

function togglePickMode() {
  pickMode.value = pickMode.value === 'center' ? 'three' : 'center';
  points.value = [];
}

function onPickUp(e: PointerEvent) {
  const vol = volume.value;
  if (!vol) return;
  if (ringDrag) {
    ringDrag = false;
    buildCurrent();
    return;
  }
  if (!ring.value && points.value.length < 3) addPoint(e, vol);
}

function onPickWheel(e: WheelEvent) {
  const vol = volume.value;
  if (!vol) return;
  if (e.ctrlKey || e.shiftKey) {
    const { i, j } = toSlicePixel(e, vol);
    zoom.k = Math.max(1, Math.min(6, zoom.k * (e.deltaY > 0 ? 1 / 1.3 : 1.3)));
    zoom.cx = i / vol.dims[0];
    zoom.cy = j / vol.dims[1];
  } else {
    const next = slice.value + (e.deltaY > 0 ? 1 : -1);
    slice.value = Math.max(0, Math.min(vol.dims[2] - 1, next));
  }
}

function resetPoints() {
  points.value = [];
  ring.value = null;
  ringAuto.value = false;
  lean.a = 0;
  lean.b = 0;
  cut.value = 0;
  cubes.value = [];
  frames.value = [];
  message.value = '';
}

// ---------------------------------------------------------------- extração

const plane = computed(() =>
  ring.value ? tiltPlane(ring.value, lean.a, lean.b) : null
);

const DETECT_FAIL = {
  'sem-contraste':
    'Não achei sangue contrastado neste exame. Marque o anel à mão.',
  'sem-aorta':
    'Não consegui localizar a aorta ascendente. Marque o anel à mão.',
  'sem-anel':
    'Achei a aorta, mas não o anel com segurança. Marque o anel à mão.',
} as const;

/** Volume em que a detecção já foi tentada (não repete sozinha). */
let detectedFor: Volume | null = null;

async function detect() {
  const vol = volume.value;
  if (!vol || busy.value) return;
  detectedFor = vol;
  resetPoints();
  busy.value = 'Procurando a valva aórtica…';
  // deixa a mensagem aparecer antes do cálculo (que ocupa a página)
  await new Promise((resolve) => {
    setTimeout(resolve, 40);
  });
  let result: ReturnType<typeof detectAorticValve>;
  try {
    result = detectAorticValve(vol, direction.value);
  } catch {
    result = { ok: false, reason: 'sem-anel' };
  }
  busy.value = '';
  if (volume.value !== vol || valve.value !== 'aortica') return;
  if (!result.ok) {
    message.value = DETECT_FAIL[result.reason];
    return;
  }
  slice.value = Math.max(
    0,
    Math.min(
      vol.dims[2] - 1,
      Math.round(result.plane.center[2] / vol.spacing[2])
    )
  );
  ring.value = result.plane;
  ringAuto.value = true;
  buildCurrent();
}

function detectIfAortic() {
  if (valve.value === 'aortica' && volume.value !== detectedFor) detect();
}

function extractAll() {
  const calcium = Math.max(threshold.value + 250, 650);
  frames.value = cubes.value.map((cube) =>
    extractSurface(cube, {
      radius: radius.value,
      from: span.value[0],
      to: span.value[1],
      threshold: threshold.value,
      calcium,
      minFragment: dust.value,
      shape: shape.value,
    })
  );
  const n = frames.value[phase.value]?.indices.length ?? 0;
  message.value = n
    ? ''
    : 'Não achei superfície com este limiar. Ajuste o limiar ou refaça os pontos.';
}

function buildCurrent() {
  const vol = volume.value;
  if (!vol || !plane.value) return;
  const cube = sampleCube(vol, plane.value);
  const blood = bloodLevel(cube);
  if (blood == null) {
    message.value =
      'Não há sangue contrastado em volta destes pontos. Esta valva precisa de contraste dos dois lados.';
    return;
  }
  threshold.value = defaultThresholds(blood).threshold;
  cubes.value = [cube];
  phase.value = 0;
  extractAll();
}

async function cubeOfPhase(id: string, dims: Vec3): Promise<Cube | null> {
  pinImage(id);
  try {
    await untilLoaded(id);
    const vol = volumeOf(id);
    const same = vol && vol.dims.every((d, a) => d === dims[a]);
    return same && plane.value ? sampleCube(vol, plane.value) : null;
  } catch {
    return null;
  } finally {
    unpinImage(id);
  }
}

async function loadAllPhases() {
  const vol = volume.value;
  if (!vol || !plane.value) return;
  const ids = phaseIds.value;
  const out: Cube[] = [];
  for (let n = 0; n < ids.length; n++) {
    busy.value = `Lendo a fase ${n + 1} de ${ids.length}…`;
    const cube = await cubeOfPhase(ids[n], vol.dims);
    if (cube) out.push(cube);
  }
  busy.value = '';
  if (out.length < 2) {
    message.value =
      'As outras partes desta série não são fases do mesmo volume.';
    return;
  }
  cubes.value = out;
  phase.value = 0;
  playing.value = true;
  extractAll();
}

watch([radius, threshold, span, dust, shape], () => {
  if (cubes.value.length) extractAll();
});
watch(valve, (v) => {
  // outra valva = outro anel: recomeça (a aórtica é procurada sozinha)
  radius.value = VALVES[v].radius;
  span.value = [-VALVES[v].below, VALVES[v].above];
  resetPoints();
  if (v === 'aortica') detect();
});
watch(volume, (vol) => {
  if (vol) detectIfAortic();
  else detectedFor = null;
});

// ------------------------------------------------------------------ desenho

let raf = 0;
let lastTick = 0;
let phaseClock = 0;

function advance(now: number) {
  const dt = Math.min(100, now - lastTick);
  lastTick = now;
  if (autoSpin.value && !drag) rot = turnOnAxis(rot, dt * 0.0006);
  phaseClock += dt;
  if (playing.value && frames.value.length > 1 && phaseClock > 110) {
    phaseClock = 0;
    phase.value = (phase.value + 1) % frames.value.length;
  }
}

/** Último quadro desenhado: parado, o mesmo quadro não é refeito. */
let lastMesh: ValveMesh | null = null;
let lastView = '';

function drawView(now: number) {
  raf = requestAnimationFrame(drawView);
  const cv = viewCanvas.value;
  const pts = frames.value[phase.value];
  if (!cv || !pts) {
    lastMesh = null;
    return;
  }
  advance(now);
  // em máquina lenta, enquanto gira sai o rascunho (sem sombras); parado,
  // gravando ou com folga de tempo, o quadro completo
  const moving = autoSpin.value || !!drag || frames.value.length > 1;
  const next = {
    spin: 0,
    tilt: 0,
    flip: false,
    rot,
    zoom: (SIZE * 0.4) / (radius.value + 6),
    style: style.value,
    clip: cut.value > 0 ? CUT_REACH - cut.value : undefined,
    fast: moving && !recording.value && fullCost > 70,
  };
  const key = JSON.stringify(next);
  if (pts === lastMesh && key === lastView) return;
  lastMesh = pts;
  lastView = key;
  const started = performance.now();
  const rgba = renderer.draw(pts, next);
  if (!next.fast && next.style === 'solid')
    fullCost = 0.7 * fullCost + 0.3 * (performance.now() - started);
  cv.getContext('2d')!.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
}

/** Custo médio (ms) do quadro completo no modo sólido, nesta máquina. */
let fullCost = 0;

let drag: { x: number; y: number } | null = null;
function onViewDown(e: PointerEvent) {
  drag = { x: e.clientX, y: e.clientY };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}
function onViewMove(e: PointerEvent) {
  if (!drag) return;
  // giro livre em torno dos eixos da tela, sem limite
  rot = turnOnScreen(
    rot,
    (e.clientX - drag.x) * 0.01,
    (e.clientY - drag.y) * 0.01
  );
  drag = { x: e.clientX, y: e.clientY };
}
function turnAround() {
  rot = turnOnScreen(rot, Math.PI, 0);
}
function resetView() {
  rot = START_VIEW;
}
function onViewUp() {
  drag = null;
}

// ------------------------------------------------------------------- saída

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function savePng() {
  viewCanvas.value?.toBlob((b) => b && download(b, `valva-${valve.value}.png`));
}

function recordVideo() {
  const cv = viewCanvas.value;
  if (!cv || recording.value) return;
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(cv.captureStream(25), {
    videoBitsPerSecond: 6e6,
  });
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => {
    recording.value = false;
    download(
      new Blob(chunks, { type: rec.mimeType }),
      `valva-${valve.value}.webm`
    );
  };
  recording.value = true;
  autoSpin.value = true;
  rec.start();
  setTimeout(() => rec.stop(), 8000);
}

// ---------------------------------------------------------------- abertura

watch(
  () => valveMode.open,
  (open) => {
    cancelAnimationFrame(raf);
    if (!open) return;
    resetPoints();
    const vol = volumeOf(currentImageID.value);
    if (vol) slice.value = Math.floor(vol.dims[2] / 2);
    raf = requestAnimationFrame(drawView);
    detectedFor = null;
    if (vol) detectIfAortic();
  }
);
watch(
  [volume, slice, points, plane, radius, () => zoom.k, pickCanvas],
  drawPick,
  {
    flush: 'post',
  }
);
onBeforeUnmount(() => cancelAnimationFrame(raf));

const hint = computed(() => {
  if (busy.value && !frames.value.length) return busy.value;
  const adjust =
    'Para ajustar: vá ao corte certo e arraste o círculo amarelo; incline com os controles abaixo.';
  if (ring.value && ringAuto.value)
    return `Valva aórtica localizada automaticamente. ${adjust}`;
  if (ring.value) return `Anel marcado. ${adjust}`;
  if (pickMode.value === 'center')
    return `Vá ao corte em que a valva ${VALVES[valve.value].name.toLowerCase()} aparece e clique no centro dela.`;
  const n = points.value.length;
  return `${VALVES[valve.value].hint} Ponto ${Math.min(n + 1, 3)} de 3.`;
});
const hasResult = computed(() => frames.value.length > 0);
const canLoadPhases = computed(
  () => hasResult.value && phaseIds.value.length > 1 && cubes.value.length === 1
);
</script>

<template>
  <v-dialog v-model="valveMode.open" fullscreen :scrim="false">
    <v-card data-testid="valve-mode" class="valve-card">
      <v-toolbar density="compact" color="surface">
        <v-toolbar-title>Valvas</v-toolbar-title>
        <v-btn-toggle
          v-model="valve"
          mandatory
          density="compact"
          variant="outlined"
          divided
        >
          <v-btn
            v-for="(cfg, key) in VALVES"
            :key="key"
            :value="key"
            class="text-none"
            size="small"
            :data-testid="`valve-${key}`"
            >{{ cfg.name }}</v-btn
          >
        </v-btn-toggle>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          aria-label="Fechar"
          data-testid="valve-close"
          @click="valveMode.open = false"
        />
      </v-toolbar>

      <div v-if="!volume" class="pa-8 text-medium-emphasis">
        Abra uma angiotomografia e espere o volume terminar de carregar para
        usar o modo Valvas.
      </div>

      <div v-else class="valve-body">
        <section class="valve-pane">
          <div class="text-body-2 mb-2" data-testid="valve-hint">
            {{ hint }}
          </div>
          <canvas
            ref="pickCanvas"
            width="640"
            height="640"
            class="valve-canvas valve-pick"
            data-testid="valve-pick"
            @pointerdown="onPickDown"
            @pointermove="onPickMove"
            @pointerup="onPickUp"
            @wheel.prevent="onPickWheel"
          />
          <div class="d-flex align-center mt-2 ga-3">
            <v-slider
              v-model="slice"
              :min="0"
              :max="volume.dims[2] - 1"
              :step="1"
              density="compact"
              hide-details
              aria-label="Corte"
            />
            <span class="text-caption valve-num"
              >{{ slice + 1 }}/{{ volume.dims[2] }}</span
            >
            <v-btn
              size="small"
              variant="text"
              class="text-none"
              data-testid="valve-reset"
              @click="resetPoints"
              >{{ ring ? 'Marcar à mão' : 'Recomeçar' }}</v-btn
            >
            <v-btn
              v-if="!ring"
              size="small"
              variant="text"
              class="text-none"
              data-testid="valve-pick-mode"
              @click="togglePickMode"
              >{{
                pickMode === 'center' ? 'Usar 3 pontos' : 'Usar o centro'
              }}</v-btn
            >
            <v-btn
              v-if="valve === 'aortica' && !ringAuto"
              size="small"
              variant="text"
              class="text-none"
              :disabled="!!busy"
              data-testid="valve-detect"
              @click="detect"
              >Localizar sozinho</v-btn
            >
          </div>
          <div class="text-caption text-medium-emphasis mt-1">
            Roda do mouse: cortes · Ctrl + roda: zoom ·
            {{
              ring
                ? 'arraste o círculo: move o centro'
                : pickMode === 'center'
                  ? 'clique: marca o centro'
                  : 'clique: marca o ponto'
            }}
          </div>
          <div v-if="ring" class="mt-2" data-testid="valve-lean">
            <div class="d-flex align-center ga-3">
              <span class="text-caption valve-label"
                >Inclinar ↔ {{ lean.a }}°</span
              >
              <v-slider
                v-model="lean.a"
                :min="-45"
                :max="45"
                :step="1"
                density="compact"
                hide-details
                aria-label="Inclinar o anel para os lados"
                @end="buildCurrent"
              />
            </div>
            <div class="d-flex align-center ga-3">
              <span class="text-caption valve-label"
                >Inclinar ↕ {{ lean.b }}°</span
              >
              <v-slider
                v-model="lean.b"
                :min="-45"
                :max="45"
                :step="1"
                density="compact"
                hide-details
                aria-label="Inclinar o anel para frente e para trás"
                @end="buildCurrent"
              />
            </div>
          </div>
        </section>

        <section class="valve-pane">
          <div class="d-flex align-center flex-wrap ga-2 mb-2">
            <v-btn-toggle
              v-model="style"
              mandatory
              density="compact"
              variant="outlined"
              divided
            >
              <v-btn
                value="holo"
                size="small"
                class="text-none"
                data-testid="valve-holo"
                >Holograma</v-btn
              >
              <v-btn
                value="solid"
                size="small"
                class="text-none"
                data-testid="valve-solid"
                >Reconstrução 3D</v-btn
              >
            </v-btn-toggle>
            <v-btn
              size="small"
              variant="text"
              class="text-none"
              @click="autoSpin = !autoSpin"
              >{{ autoSpin ? 'Parar giro' : 'Girar' }}</v-btn
            >
            <v-btn
              size="small"
              variant="text"
              class="text-none"
              @click="turnAround"
              >Ver do outro lado</v-btn
            >
            <v-btn
              size="small"
              variant="text"
              class="text-none"
              @click="resetView"
              >Vista inicial</v-btn
            >
            <v-btn
              v-if="frames.length > 1"
              size="small"
              variant="text"
              class="text-none"
              @click="playing = !playing"
              >{{ playing ? 'Pausar batimento' : 'Bater' }}</v-btn
            >
          </div>
          <canvas
            ref="viewCanvas"
            :width="SIZE"
            :height="SIZE"
            class="valve-canvas valve-view"
            data-testid="valve-view"
            @pointerdown="onViewDown"
            @pointermove="onViewMove"
            @pointerup="onViewUp"
          />
          <v-alert
            v-if="message"
            density="compact"
            variant="tonal"
            type="warning"
            class="mt-2 text-body-2"
            data-testid="valve-message"
          >
            {{ message }}
          </v-alert>
          <div v-if="hasResult" class="mt-2">
            <div class="d-flex align-center ga-3">
              <span class="text-caption valve-label">Raio {{ radius }} mm</span>
              <v-slider
                v-model="radius"
                :min="10"
                :max="36"
                :step="1"
                density="compact"
                hide-details
                aria-label="Raio"
              />
            </div>
            <div class="d-flex align-center ga-3 mb-1">
              <span class="text-caption valve-label">Região</span>
              <v-btn-toggle
                v-model="shape"
                mandatory
                density="compact"
                variant="outlined"
                divided
              >
                <v-btn
                  value="cylinder"
                  size="small"
                  class="text-none"
                  data-testid="valve-cylinder"
                  >Cilindro</v-btn
                >
                <v-btn
                  value="sphere"
                  size="small"
                  class="text-none"
                  data-testid="valve-sphere"
                  >Esfera</v-btn
                >
              </v-btn-toggle>
            </div>
            <div v-if="shape === 'cylinder'" class="d-flex align-center ga-3">
              <span class="text-caption valve-label"
                >Altura {{ span[0] }} a {{ span[1] }} mm</span
              >
              <v-range-slider
                v-model="span"
                :min="-30"
                :max="30"
                :step="1"
                density="compact"
                hide-details
                aria-label="Faixa ao longo do eixo da valva"
                data-testid="valve-span"
              />
            </div>
            <div class="d-flex align-center ga-3">
              <span class="text-caption valve-label"
                >Corte {{ cut ? `${cut} mm` : 'sem' }}</span
              >
              <v-slider
                v-model="cut"
                :min="0"
                :max="2 * CUT_REACH"
                :step="1"
                density="compact"
                hide-details
                aria-label="Cortar a frente da imagem"
                data-testid="valve-cut"
                @start="autoSpin = false"
              />
            </div>
            <div class="d-flex align-center ga-3">
              <span class="text-caption valve-label"
                >Poeira {{ dust ? `< ${dust} mm²` : 'mantém' }}</span
              >
              <v-slider
                v-model="dust"
                :min="0"
                :max="400"
                :step="10"
                density="compact"
                hide-details
                aria-label="Retirar pedaços soltos pequenos"
                data-testid="valve-dust"
              />
            </div>
            <div class="d-flex align-center ga-3">
              <span class="text-caption valve-label"
                >Limiar {{ threshold }} UH</span
              >
              <v-slider
                v-model="threshold"
                :min="80"
                :max="600"
                :step="10"
                density="compact"
                hide-details
                aria-label="Limiar"
              />
            </div>
            <div class="d-flex align-center flex-wrap ga-2 mt-2">
              <v-btn
                v-if="canLoadPhases"
                size="small"
                color="primary"
                variant="flat"
                class="text-none"
                :loading="!!busy"
                data-testid="valve-phases"
                @click="loadAllPhases"
                >Fazer bater ({{ phaseIds.length }} fases)</v-btn
              >
              <span v-if="frames.length > 1" class="text-caption"
                >Fase {{ phase + 1 }} de {{ frames.length }}</span
              >
              <v-spacer />
              <v-btn
                size="small"
                variant="outlined"
                class="text-none"
                @click="savePng"
                >Salvar imagem</v-btn
              >
              <v-btn
                size="small"
                variant="outlined"
                class="text-none"
                :disabled="recording"
                @click="recordVideo"
                >{{ recording ? 'Gravando 8 s…' : 'Gravar vídeo' }}</v-btn
              >
            </div>
            <div v-if="busy" class="text-caption mt-1">{{ busy }}</div>
          </div>
        </section>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.valve-card {
  background: rgb(var(--v-theme-background));
}
.valve-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 16px;
}
.valve-pane {
  min-width: 0;
}
.valve-canvas {
  width: 100%;
  max-width: min(640px, calc(100vh - 260px));
  aspect-ratio: 1;
  display: block;
  background: #000;
  border-radius: 6px;
}
.valve-pick {
  cursor: crosshair;
}
.valve-view {
  cursor: grab;
  touch-action: none;
}
.valve-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.valve-label {
  width: 150px;
  flex: none;
}
@media (max-width: 900px) {
  .valve-body {
    grid-template-columns: 1fr;
  }
}
</style>
