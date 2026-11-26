<script setup lang="ts">
/**
 * CatStudio — diretor de arte: o usuário descreve a imagem ("sagital na linha
 * hemiclavicular esquerda, partes moles") e recebe o corte pronto, desenhado
 * uma vez. Ajustes também por texto, ou clicando no localizador.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import { useCurrentImage } from '@/src/composables/useCurrentImage';
import { useImageCacheStore } from '@/src/store/image-cache';
import { download } from '@/src/catstudio/capture';
import { pinImage, unpinImage } from '@/src/catstudio/lazy';
import {
  CLOUD_FAILURE_TEXT,
  CloudError,
  askCloud,
  cloudConfig,
} from '@/src/catstudio/director/cloud';
import {
  askClaude,
  claudeSample,
  type ClaudeSample,
} from '@/src/catstudio/director/claude';
import { drawCut, drawLocator } from '@/src/catstudio/director/compose';
import {
  lineOnLocator,
  locatorRecipe,
  positionFromPixel,
  renderCut,
  type CutJob,
} from '@/src/catstudio/director/cut';
import {
  alignedVolume,
  estimateRoll,
  rollNotes,
} from '@/src/catstudio/director/alignment';
import {
  shiftLimits,
  useStrip,
  type Space,
} from '@/src/catstudio/director/useStrip';
import { useStripNavigation } from '@/src/catstudio/director/useStripNavigation';
import { interpret, lateralSignOf } from '@/src/catstudio/director/interpret';
import {
  findLandmarks,
  type Landmarks,
} from '@/src/catstudio/director/landmarks';
import { directorMode } from '@/src/catstudio/director/mode';
import {
  NORMAL_AXIS,
  cutPosition,
  describeRecipe,
  isEstimated,
  type Recipe,
} from '@/src/catstudio/director/recipe';
import { volumeFromImage, type Vec3 } from '@/src/catstudio/director/volume';

const EXAMPLES = [
  'Sagital na linha hemiclavicular esquerda, partes moles',
  'Coronal na linha axilar média, MIP de 20 mm, janela de pulmão',
  'Axial no ápice pulmonar, janela de pulmão',
  'Sagital na linha média, em 3D',
];
const LOCATOR_SIDE = 240;

const imageCache = useImageCacheStore();
const { currentImageID, currentImageData } = useCurrentImage();

const text = ref('');
const busy = ref('');
const notes = ref<string[]>([]);
const source = ref<'ia' | 'local' | ''>('');
const comment = ref('');
const recipe = shallowRef<Recipe | null>(null);
const history = shallowRef<Recipe[]>([]);
/** O exame endireitado (eixos do paciente) e como veio do aparelho. */
const spaces = shallowRef<Record<Recipe['alinhamento'], Space> | null>(null);
/** Referências do exame endireitado (para a IA e os pedidos). */
const landmarks = computed(() => spaces.value?.paciente.lm ?? null);
const locator = shallowRef<CutJob | null>(null);
/** Nível do localizador escolhido à mão (mm); null = o padrão. */
const locatorAt = ref<number | null>(null);
const cutCanvas = ref<HTMLCanvasElement | null>(null);
const locatorCanvas = ref<HTMLCanvasElement | null>(null);
const cloud = ref(cloudConfig());
/** Aberto dentro do Claude: dá para perguntar a ele, sem servidor. */
const claude = shallowRef<ClaudeSample | null>(null);
claudeSample().then((sample) => {
  claude.value = sample;
});
const spaceOf = (target: Recipe) => spaces.value?.[target.alinhamento] ?? null;

const strip = useStrip({
  open: () => directorMode.open,
  spaceOf,
  draw: (job, target, preview) => {
    if (!cutCanvas.value) return;
    const caption = preview
      ? `${describeOf(target)} · esboço`
      : describeOf(target);
    drawCut(cutCanvas.value, job, target, caption);
    renderLocator();
  },
});

const describeOf = (target: Recipe) =>
  describeRecipe(target, spaceOf(target)?.lm);

const pause = () => new Promise<void>((resolve) => setTimeout(resolve));

/** Lê o volume e estima as referências uma vez por exame aberto. */
async function prepare() {
  const id = currentImageID.value;
  const image = imageCache.getVtkImageData(id);
  const scalars = image?.getPointData().getScalars();
  spaces.value = null;
  strip.reset();
  recipe.value = null;
  history.value = [];
  notes.value = [];
  if (!id || !image || !scalars || scalars.getNumberOfComponents() !== 1) {
    notes.value = ['Abra uma série de tomografia para usar o diretor de arte.'];
    return;
  }
  busy.value = 'Analisando o exame…';
  await pause();
  const vol = volumeFromImage(
    image,
    scalars.getData() as ArrayLike<number>,
    image.getDimensions() as Vec3
  );
  const lm = findLandmarks(vol);
  const roll = estimateRoll(vol, lm);
  const straight = alignedVolume(vol, roll);
  const straightLm = straight === vol ? lm : findLandmarks(straight);
  spaces.value = {
    aparelho: { vol, lm },
    paciente: { vol: straight, lm: straightLm },
  };
  notes.value = [...straightLm.notes, ...rollNotes(roll.angle)];
  busy.value = '';
}

watch(
  () => [directorMode.open, currentImageID.value, currentImageData.value],
  ([open], _old, onCleanup) => {
    if (!open) return;
    const id = currentImageID.value;
    if (id) pinImage(id);
    onCleanup(() => id && unpinImage(id));
    cloud.value = cloudConfig();
    prepare();
  }
);

const engine = computed(() => {
  if (claude.value)
    return 'IA do Claude (só o texto do pedido sai do computador)';
  if (cloud.value)
    return 'IA pela nuvem do CineDeck (só o texto do pedido sai do computador)';
  return 'Interpretador local (nada sai do computador)';
});

const understood = computed(() =>
  recipe.value ? describeOf(recipe.value) : ''
);
const estimated = computed(
  () => !!recipe.value && isEstimated(recipe.value.referencia)
);

/** Mostra o corte da receita atual (na hora, se já estiver desenhado). */
function render() {
  if (recipe.value) strip.show(recipe.value);
}

let locatorKey = '';

function renderLocator() {
  const target = recipe.value;
  const space = target ? spaceOf(target) : null;
  if (!space || !target || !locatorCanvas.value) return;
  const { vol, lm } = space;
  const base = locatorRecipe(target, lm);
  const view =
    locatorAt.value === null ? base : { ...base, ponto: locatorAt.value };
  // a imagem do localizador só muda com o plano dele; a linha muda sempre
  const key = JSON.stringify({ ...view, deslocamento: 0 });
  if (key !== locatorKey || !locator.value) {
    locator.value = renderCut(vol, view, lm, LOCATOR_SIDE);
    locatorKey = key;
  }
  drawLocator(
    locatorCanvas.value,
    locator.value,
    view,
    lineOnLocator(locator.value, target, lm)
  );
}

function adopt(next: Recipe) {
  if (recipe.value) history.value = [...history.value, recipe.value];
  // plano novo: o localizador volta ao nível padrão
  if (recipe.value?.plano !== next.plano) locatorAt.value = null;
  recipe.value = next;
  render();
}

function undo() {
  const previous = history.value.at(-1);
  if (!previous) return;
  history.value = history.value.slice(0, -1);
  recipe.value = previous;
  render();
}

function lateralSign() {
  const lm = recipe.value ? spaceOf(recipe.value)?.lm : null;
  if (!lm || !recipe.value) return 1;
  return lateralSignOf(cutPosition(recipe.value, lm), lm.midlineX);
}

async function fromClaude(request: string, lm: Landmarks) {
  if (!claude.value) return null;
  busy.value = 'Perguntando ao Claude…';
  try {
    return await askClaude(claude.value, {
      text: request,
      current: recipe.value,
      landmarks: lm,
    });
  } catch {
    notes.value.push('O Claude não respondeu ao pedido.');
    return null;
  }
}

async function fromCloud(request: string, lm: Landmarks) {
  if (!cloud.value) {
    if (claude.value) notes.value.push('Usei o interpretador local.');
    return null;
  }
  busy.value = 'Perguntando à IA…';
  try {
    return await askCloud(cloud.value, {
      text: request,
      current: recipe.value,
      landmarks: lm,
    });
  } catch (error) {
    const reason = error instanceof CloudError ? error.reason : 'rede';
    notes.value.push(
      `${CLOUD_FAILURE_TEXT[reason]} Usei o interpretador local.`
    );
    return null;
  }
}

async function submit() {
  const request = text.value.trim();
  const lm = landmarks.value;
  if (!request || !lm || busy.value) return;
  notes.value = [...lm.notes];
  comment.value = '';
  const answer =
    (await fromClaude(request, lm)) ?? (await fromCloud(request, lm));
  busy.value = '';
  if (answer) {
    source.value = 'ia';
    comment.value = answer.comment;
    text.value = '';
    // eixos e isolamento a IA pode não conhecer: o texto decide
    const local = interpret(request, answer.recipe, lateralSign()).recipe;
    adopt({
      ...answer.recipe,
      alinhamento: local.alinhamento,
      isolar: local.isolar,
    });
    return;
  }
  const local = interpret(request, recipe.value, lateralSign());
  notes.value.push(...local.notes);
  if (!local.understood) return;
  source.value = 'local';
  text.value = '';
  adopt(local.recipe);
}

function useExample(example: string) {
  text.value = example;
  submit();
}

/** Clique no localizador: o corte passa a passar por ali. */
function onLocatorClick(event: MouseEvent) {
  const canvas = locatorCanvas.value;
  if (!canvas || !locator.value || !recipe.value || busy.value) return;
  const box = canvas.getBoundingClientRect();
  const col = ((event.clientX - box.left) / box.width) * canvas.width;
  const row = ((event.clientY - box.top) / box.height) * canvas.height;
  const ponto = positionFromPixel(locator.value, col, row, recipe.value);
  locatorKey = '';
  adopt({ ...recipe.value, referencia: 'ponto', ponto, deslocamento: 0 });
}

const { position, moveTo, nudge, onWheel, onKey, nudgeLabels } =
  useStripNavigation({
    recipe,
    blocked: () => !!busy.value,
    limits: (target) => {
      const lm = spaceOf(target)?.lm;
      return lm ? shiftLimits(target, lm) : null;
    },
    render,
  });

/** Faixa por onde o localizador pode andar (eixo perpendicular a ele). */
const locatorRange = computed(() => {
  const lm = landmarks.value;
  const target = recipe.value;
  if (!lm || !target) return null;
  const view = locatorRecipe(target, lm);
  const axis = NORMAL_AXIS[view.plano];
  return {
    min: Math.round(lm.body[0][axis]),
    max: Math.round(lm.body[1][axis]),
    value: Math.round(locatorAt.value ?? view.ponto),
    label:
      view.plano === 'axial'
        ? 'Altura do localizador'
        : 'Profundidade do localizador',
  };
});

function moveLocator(value: number) {
  locatorAt.value = value;
  renderLocator();
}

const drawingText = computed(() => busy.value || strip.drawing.value);

// setas andam pela fita enquanto o diretor está aberto
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (directorMode.open) onKey(event);
});

function savePng() {
  cutCanvas.value?.toBlob(
    (blob) => blob && download(blob, `corte-${recipe.value?.plano ?? ''}.png`)
  );
}
</script>

<template>
  <v-dialog v-model="directorMode.open" fullscreen :scrim="false">
    <v-card data-testid="director-mode" class="director-card">
      <v-toolbar density="compact" color="surface">
        <v-toolbar-title>Diretor de arte</v-toolbar-title>
        <span class="text-caption mr-4" data-testid="director-engine">
          {{ engine }}
        </span>
        <v-btn
          icon="mdi-close"
          aria-label="Fechar"
          data-testid="director-close"
          @click="directorMode.open = false"
        />
      </v-toolbar>
      <div class="director-body">
        <div class="director-side">
          <v-textarea
            v-model="text"
            label="Que imagem você quer?"
            rows="3"
            auto-grow
            hide-details
            :disabled="!landmarks"
            data-testid="director-text"
            @keydown.enter.exact.prevent="submit"
          />
          <div class="d-flex align-center ga-2 mt-2">
            <v-btn
              color="primary"
              class="text-none"
              :disabled="!landmarks || !text.trim() || !!busy"
              data-testid="director-go"
              @click="submit"
              >{{ recipe ? 'Ajustar' : 'Gerar' }}</v-btn
            >
            <v-btn
              variant="text"
              class="text-none"
              :disabled="!history.length || !!busy"
              data-testid="director-undo"
              @click="undo"
              >Desfazer</v-btn
            >
            <span class="text-caption" data-testid="director-busy">{{
              drawingText
            }}</span>
          </div>
          <div v-if="!recipe" class="mt-3">
            <div class="text-caption mb-1">Exemplos</div>
            <v-chip
              v-for="example in EXAMPLES"
              :key="example"
              size="small"
              class="ma-1"
              :disabled="!landmarks || !!busy"
              @click="useExample(example)"
              >{{ example }}</v-chip
            >
          </div>
          <div v-else class="text-caption mt-3">
            Para ajustar, escreva: “2 cm mais lateral”, “MIP de 20 mm”, “janela
            de pulmão”, “fundo branco”, “só o tórax”, “em 3D”.
          </div>
          <div
            v-if="understood"
            class="director-understood mt-3"
            data-testid="director-understood"
          >
            <strong>{{ source === 'ia' ? 'IA' : 'Entendi' }}:</strong>
            {{ understood }}
            <div v-if="comment" class="mt-1">{{ comment }}</div>
            <div v-if="estimated" class="mt-1 director-warn">
              A linha é estimada pela largura do tórax, não medida na clavícula.
              Confira no localizador e corrija clicando nele.
            </div>
          </div>
          <div
            v-for="note in notes"
            :key="note"
            class="director-warn text-caption mt-2"
            data-testid="director-note"
          >
            {{ note }}
          </div>
          <template v-if="recipe">
            <div class="text-caption mt-4 mb-1">
              Localizador (clique para o corte passar por ali)
            </div>
            <canvas
              ref="locatorCanvas"
              class="director-locator"
              data-testid="director-locator"
              @click="onLocatorClick"
            />
            <div v-if="locatorRange" class="d-flex align-center ga-2">
              <span class="text-caption">{{ locatorRange.label }}</span>
              <v-slider
                :model-value="locatorRange.value"
                :min="locatorRange.min"
                :max="locatorRange.max"
                :step="2"
                density="compact"
                hide-details
                :aria-label="locatorRange.label"
                data-testid="director-locator-level"
                @update:model-value="moveLocator"
              />
            </div>
            <div v-if="position" class="d-flex align-center ga-2 mt-3">
              <span class="text-caption">Posição</span>
              <v-slider
                :model-value="position.value"
                :min="position.min"
                :max="position.max"
                :step="5"
                density="compact"
                hide-details
                aria-label="Posição do corte"
                data-testid="director-position"
                @update:model-value="moveTo"
              />
              <span class="text-caption director-mm"
                >{{ position.value > 0 ? '+' : ''
                }}{{ Math.round(position.value) }} mm</span
              >
            </div>
            <div
              class="text-caption director-strip"
              data-testid="director-strip"
            >
              {{ strip.stripText.value }}
              <span v-if="strip.stripText.value"
                >· roda do mouse ou ← → para andar</span
              >
            </div>
            <div class="d-flex align-center flex-wrap ga-2 mt-2">
              <v-btn
                size="small"
                variant="outlined"
                class="text-none"
                :disabled="!!busy"
                data-testid="director-nudge-minus"
                @click="nudge(-5)"
                >◀ 5 mm {{ nudgeLabels[0] }}</v-btn
              >
              <v-btn
                size="small"
                variant="outlined"
                class="text-none"
                :disabled="!!busy"
                data-testid="director-nudge-plus"
                @click="nudge(5)"
                >5 mm {{ nudgeLabels[1] }} ▶</v-btn
              >
              <v-btn
                size="small"
                color="primary"
                variant="tonal"
                class="text-none"
                :disabled="!!busy"
                data-testid="director-png"
                @click="savePng"
                >Salvar PNG</v-btn
              >
            </div>
          </template>
        </div>
        <div class="director-stage">
          <canvas
            v-show="recipe"
            ref="cutCanvas"
            class="director-cut"
            data-testid="director-cut"
            @wheel="onWheel"
          />
          <div v-if="!recipe" class="text-medium-emphasis">
            Descreva a imagem ao lado. O corte é desenhado uma vez, sem usar a
            placa de vídeo.
          </div>
        </div>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.director-card {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.director-body {
  display: flex;
  flex: 1;
  min-height: 0;
}
.director-side {
  width: 380px;
  flex: none;
  padding: 16px;
  overflow-y: auto;
}
.director-stage {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: #0b0d10;
}
.director-cut {
  max-width: 100%;
  max-height: 100%;
}
.director-locator {
  width: 100%;
  max-width: 300px;
  cursor: crosshair;
  border: 1px solid rgba(255, 255, 255, 0.2);
}
.director-understood {
  font-size: 13px;
  line-height: 1.35;
}
.director-mm {
  min-width: 56px;
  text-align: right;
}

.director-strip {
  min-height: 18px;
  opacity: 0.7;
}

.director-warn {
  color: #ffd166;
}
@media (max-width: 900px) {
  .director-body {
    flex-direction: column;
  }
  .director-side {
    width: auto;
  }
}
</style>
