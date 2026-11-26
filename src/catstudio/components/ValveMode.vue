<script setup lang="ts">
/**
 * CatStudio — modo Valvas: marca-se o anel em três pontos no corte axial e a
 * valva aparece como holograma ou reconstrução 3D; com várias fases, batendo.
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
  type ValveKey,
  type Vec3,
  type Volume,
} from '@/src/catstudio/valve';
import { createValveRenderer } from '@/src/catstudio/valveRender';
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
const flip = ref(false);
const playing = ref(true);
const radius = ref(VALVES.aortica.radius);
const threshold = ref(250);
const message = ref('');
const busy = ref('');
const recording = ref(false);

const cubes = shallowRef<Cube[]>([]);
const frames = shallowRef<Float32Array[]>([]);
const phase = ref(0);
const view = reactive({ spin: 0.6, tilt: 0.95 });

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
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.font = '600 13px sans-serif';
    ctx.fillText(String(n + 1), x + 9, y - 7);
  });
}

function toSlicePixel(e: MouseEvent, vol: Volume) {
  const box = pickCanvas.value!.getBoundingClientRect();
  const r = visibleRect(vol);
  return {
    i: r.x + ((e.clientX - box.left) / box.width) * r.w,
    j: r.y + ((e.clientY - box.top) / box.height) * r.h,
  };
}

function onPickClick(e: MouseEvent) {
  const vol = volume.value;
  if (!vol || points.value.length >= 3) return;
  const { i, j } = toSlicePixel(e, vol);
  points.value = [
    ...points.value,
    [i * vol.spacing[0], j * vol.spacing[1], slice.value * vol.spacing[2]],
  ];
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
  cubes.value = [];
  frames.value = [];
  message.value = '';
}

// ---------------------------------------------------------------- extração

const plane = computed(() =>
  points.value.length === 3
    ? planeFromPoints(points.value[0], points.value[1], points.value[2])
    : null
);

function extractAll() {
  const cfg = VALVES[valve.value];
  const calcium = Math.max(threshold.value + 250, 650);
  frames.value = cubes.value.map((cube) =>
    extractSurface(cube, {
      radius: radius.value,
      from: -cfg.below,
      to: cfg.above,
      threshold: threshold.value,
      calcium,
    })
  );
  const n = frames.value[phase.value]?.length ?? 0;
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

watch(plane, (p) => {
  if (points.value.length === 3 && !p)
    message.value = 'Os três pontos estão alinhados. Refaça os pontos.';
  if (p) buildCurrent();
});
watch([radius, threshold], () => {
  if (cubes.value.length) extractAll();
});
watch(valve, (v) => {
  radius.value = VALVES[v].radius;
  if (cubes.value.length) extractAll();
});

// ------------------------------------------------------------------ desenho

let raf = 0;
let lastTick = 0;
let phaseClock = 0;

function advance(now: number) {
  const dt = Math.min(100, now - lastTick);
  lastTick = now;
  if (autoSpin.value && !drag) view.spin += dt * 0.0006;
  phaseClock += dt;
  if (playing.value && frames.value.length > 1 && phaseClock > 110) {
    phaseClock = 0;
    phase.value = (phase.value + 1) % frames.value.length;
  }
}

function drawView(now: number) {
  raf = requestAnimationFrame(drawView);
  const cv = viewCanvas.value;
  const pts = frames.value[phase.value];
  if (!cv || !pts) return;
  advance(now);
  const rgba = renderer.draw(pts, {
    spin: view.spin,
    tilt: view.tilt,
    zoom: (SIZE * 0.4) / (radius.value + 6),
    style: style.value,
    flip: flip.value,
    step: cubes.value[0].step,
  });
  cv.getContext('2d')!.putImageData(new ImageData(rgba, SIZE, SIZE), 0, 0);
}

let drag: { x: number; y: number } | null = null;
function onViewDown(e: PointerEvent) {
  drag = { x: e.clientX, y: e.clientY };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
}
function onViewMove(e: PointerEvent) {
  if (!drag) return;
  view.spin += (e.clientX - drag.x) * 0.01;
  view.tilt = Math.max(
    0,
    Math.min(Math.PI, view.tilt - (e.clientY - drag.y) * 0.01)
  );
  drag = { x: e.clientX, y: e.clientY };
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
  }
);
watch([volume, slice, points, () => zoom.k, pickCanvas], drawPick, {
  flush: 'post',
});
onBeforeUnmount(() => cancelAnimationFrame(raf));

const hint = computed(() => {
  const n = points.value.length;
  if (n < 3) return `${VALVES[valve.value].hint} Ponto ${n + 1} de 3.`;
  return 'Arraste a valva para girar.';
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
            @click="onPickClick"
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
              >Refazer pontos</v-btn
            >
          </div>
          <div class="text-caption text-medium-emphasis mt-1">
            Roda do mouse: cortes · Ctrl + roda: zoom · clique: marca o ponto
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
              @click="flip = !flip"
              >Ver do outro lado</v-btn
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
  width: 110px;
  flex: none;
}
@media (max-width: 900px) {
  .valve-body {
    grid-template-columns: 1fr;
  }
}
</style>
