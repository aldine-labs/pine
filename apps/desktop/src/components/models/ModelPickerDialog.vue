<script setup lang="ts">
import {
  ArrowLeftIcon,
  CheckIcon,
  HeartIcon,
  ImageIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  UnplugIcon,
  WrenchIcon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type {
  PineImageModelDescriptor,
  PineModelDescriptor,
  PineProviderDescriptor,
} from "@/shared/models";
import { pineModelKey, useModelsStore } from "@/stores/models";
import ModelCapabilities from "./ModelCapabilities.vue";
import CustomModelDialog from "./CustomModelDialog.vue";
import CustomProviderDialog from "./CustomProviderDialog.vue";
import ProviderAuthDialog from "./ProviderAuthDialog.vue";
import ProviderIcon from "./ProviderIcon.vue";

type PickerView = "models" | "providers";

const props = withDefaults(
  defineProps<{
    open: boolean;
    purpose?: "session" | "utility" | "image";
    sessionId?: string;
  }>(),
  { purpose: "session" },
);
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18n();
const modelsStore = useModelsStore();
const {
  imageModels,
  imageSelection,
  isLoading,
  models,
  providers,
  utilitySelection,
} = storeToRefs(modelsStore);
const isImagePurpose = computed(() => props.purpose === "image");
const sessionSelection = computed(() =>
  modelsStore.selectionFor(props.sessionId),
);
const view = ref<PickerView>("models");
const isAuthOpen = ref(false);
const selectedProvider = ref<PineProviderDescriptor | null>(null);
const disconnectingProvider = ref<PineProviderDescriptor | null>(null);
const isDisconnectDialogOpen = ref(false);
const isDisconnecting = ref(false);
const isCustomModelOpen = ref(false);
const isCustomProviderOpen = ref(false);
const editingCustomModel = ref<PineModelDescriptor | null>(null);
const editingCustomProvider = ref<PineProviderDescriptor | null>(null);
const customDeleteTarget = ref<
  | { kind: "model"; model: PineModelDescriptor }
  | { kind: "provider"; provider: PineProviderDescriptor }
  | null
>(null);
const isCustomDeleteDialogOpen = ref(false);
const isDeletingCustom = ref(false);
const favoriteModelKeysAtOpen = ref<readonly string[]>([]);
const providerModelGroups = computed(() =>
  providers.value
    .filter((provider) => provider.configured)
    .map((provider) => ({
      heading: provider.name,
      id: `provider:${provider.id}`,
      models: models.value.filter((model) => model.providerId === provider.id),
    }))
    .filter((group) => group.models.length > 0),
);
const availableModels = computed(() =>
  providerModelGroups.value.flatMap((group) => group.models),
);
const modelGroups = computed(() =>
  [
    {
      heading: t("models.favorites"),
      id: "favorites",
      models: availableModels.value.filter((model) =>
        favoriteModelKeysAtOpen.value.includes(pineModelKey(model)),
      ),
    },
    {
      heading: t("models.recommended"),
      id: "recommended",
      models: availableModels.value.filter((model) =>
        modelsStore.isRecommended(model),
      ),
    },
    ...providerModelGroups.value,
  ].filter((group) => group.models.length > 0),
);
/**
 * Image models are a separate pi-ai catalog served by OpenRouter only, so the
 * image purpose skips favorites, capabilities, and custom-model management.
 */
const imageModelGroups = computed(() =>
  imageModels.value.length > 0
    ? [
        {
          heading: imageModels.value[0]?.providerName ?? "",
          id: "image-models",
          models: imageModels.value,
        },
      ]
    : [],
);
const title = computed(() =>
  view.value === "providers"
    ? t("providers.picker.title")
    : isImagePurpose.value
      ? t("models.picker.imageTitle")
      : t("models.picker.title"),
);
const description = computed(() =>
  view.value === "providers"
    ? t("providers.picker.description")
    : isImagePurpose.value
      ? t("models.picker.imageDescription")
      : t("models.picker.description"),
);
const searchPlaceholder = computed(() =>
  view.value === "providers"
    ? t("providers.picker.searchPlaceholder")
    : isImagePurpose.value
      ? t("models.picker.imageSearchPlaceholder")
      : t("models.picker.searchPlaceholder"),
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    view.value = "models";
    favoriteModelKeysAtOpen.value = modelsStore.favoriteModelKeysSnapshot();
    void modelsStore.load();
  },
);

function isSelected(model: PineModelDescriptor): boolean {
  const selected =
    props.purpose === "image"
      ? imageSelection.value
      : props.purpose === "utility"
        ? utilitySelection.value
        : sessionSelection.value;
  return (
    selected?.providerId === model.providerId && selected.modelId === model.id
  );
}

function isImageModelSelected(model: PineImageModelDescriptor): boolean {
  return (
    imageSelection.value?.providerId === model.providerId &&
    imageSelection.value.modelId === model.id
  );
}

function canConfigure(provider: PineProviderDescriptor): boolean {
  return provider.authMethods.length > 0;
}

function selectProvider(provider: PineProviderDescriptor): void {
  if (provider.isCustom) return;
  if (!canConfigure(provider)) return;
  void openAuth(provider);
}

async function openAuth(provider: PineProviderDescriptor): Promise<void> {
  selectedProvider.value = provider;
  emit("update:open", false);
  await nextTick();
  isAuthOpen.value = true;
}

async function openCustomModel(): Promise<void> {
  editingCustomModel.value = null;
  emit("update:open", false);
  await nextTick();
  isCustomModelOpen.value = true;
}

async function openCustomModelEditor(
  model: PineModelDescriptor,
): Promise<void> {
  editingCustomModel.value = model;
  emit("update:open", false);
  await nextTick();
  isCustomModelOpen.value = true;
}

async function openCustomProviderEditor(
  provider: PineProviderDescriptor,
): Promise<void> {
  editingCustomProvider.value = provider;
  emit("update:open", false);
  await nextTick();
  isCustomProviderOpen.value = true;
}

async function customModelOpenChanged(open: boolean): Promise<void> {
  isCustomModelOpen.value = open;
  if (open) return;
  editingCustomModel.value = null;
  await nextTick();
  emit("update:open", true);
}

async function handleCustomModelSaved(): Promise<void> {
  view.value = "models";
  editingCustomModel.value = null;
  isCustomModelOpen.value = false;
  await nextTick();
  emit("update:open", true);
}

async function customProviderOpenChanged(open: boolean): Promise<void> {
  isCustomProviderOpen.value = open;
  if (open) return;
  editingCustomProvider.value = null;
  await nextTick();
  emit("update:open", true);
}

async function handleCustomProviderSaved(): Promise<void> {
  view.value = "providers";
  editingCustomProvider.value = null;
  isCustomProviderOpen.value = false;
  await nextTick();
  emit("update:open", true);
}

async function selectModel(model: PineModelDescriptor): Promise<void> {
  try {
    if (props.purpose === "utility") {
      await modelsStore.selectUtilityModel(model);
    } else {
      await modelsStore.select(model, undefined, props.sessionId);
    }
    emit("update:open", false);
  } catch (error) {
    if (props.purpose !== "utility") throw error;
    handleError(error, {
      id: "preferences.utility-model",
      title: t("errors.utilityModel.title"),
      description: t("errors.utilityModel.description"),
    });
  }
}

async function selectImageModel(
  model: PineImageModelDescriptor,
): Promise<void> {
  try {
    await modelsStore.selectImageModel(model);
    emit("update:open", false);
  } catch (error) {
    handleError(error, {
      id: "preferences.image-model",
      title: t("errors.imageModel.title"),
      description: t("errors.imageModel.description"),
    });
  }
}

function requestDisconnect(provider: PineProviderDescriptor): void {
  disconnectingProvider.value = provider;
  isDisconnectDialogOpen.value = true;
}

function requestCustomDelete(
  target:
    | { kind: "model"; model: PineModelDescriptor }
    | { kind: "provider"; provider: PineProviderDescriptor },
): void {
  customDeleteTarget.value = target;
  isCustomDeleteDialogOpen.value = true;
}

function customDeleteDialogOpenChanged(open: boolean): void {
  isCustomDeleteDialogOpen.value = open;
  if (open) return;
  queueMicrotask(() => {
    if (!isCustomDeleteDialogOpen.value && !isDeletingCustom.value) {
      customDeleteTarget.value = null;
    }
  });
}

async function deleteCustomTarget(): Promise<void> {
  const target = customDeleteTarget.value;
  if (!target || isDeletingCustom.value) return;
  isDeletingCustom.value = true;
  try {
    if (target.kind === "model") {
      await modelsStore.deleteCustomModel({
        modelId: target.model.id,
        providerId: target.model.providerId,
      });
    } else {
      await modelsStore.deleteCustomProvider({
        providerId: target.provider.id,
      });
    }
    isCustomDeleteDialogOpen.value = false;
    customDeleteTarget.value = null;
  } catch (error) {
    handleError(error, {
      id: `models.delete-custom.${target.kind}`,
      title: t("errors.customDelete.title"),
      description: t("errors.customDelete.description"),
    });
  } finally {
    isDeletingCustom.value = false;
    if (!isCustomDeleteDialogOpen.value) customDeleteTarget.value = null;
  }
}

function disconnectDialogOpenChanged(open: boolean): void {
  isDisconnectDialogOpen.value = open;
  if (open) return;

  queueMicrotask(() => {
    if (!isDisconnectDialogOpen.value && !isDisconnecting.value) {
      disconnectingProvider.value = null;
    }
  });
}

async function disconnectProvider(): Promise<void> {
  const provider = disconnectingProvider.value;
  if (!provider || isDisconnecting.value) return;

  isDisconnecting.value = true;
  try {
    await modelsStore.logout(provider.id);
    isDisconnectDialogOpen.value = false;
    disconnectingProvider.value = null;
  } catch (error) {
    handleError(error, {
      id: `provider.disconnect.${provider.id}`,
      title: t("errors.providerDisconnect.title"),
      description: t("errors.providerDisconnect.description"),
    });
  } finally {
    isDisconnecting.value = false;
    if (!isDisconnectDialogOpen.value) disconnectingProvider.value = null;
  }
}

async function handleConnected(): Promise<void> {
  isAuthOpen.value = false;
  selectedProvider.value = null;
  await nextTick();
  emit("update:open", true);
}
</script>

<template>
  <CommandDialog
    :open="open"
    :title="title"
    :description="description"
    class="top-1/2 -translate-y-1/2"
    @update:open="emit('update:open', $event)"
  >
    <CommandInput :placeholder="searchPlaceholder" />
    <CommandList
      class="h-[50vh] min-h-72 max-h-[50vh] [&>[role=presentation]]:flex [&>[role=presentation]]:min-h-72 [&>[role=presentation]]:flex-col"
    >
      <CommandEmpty>
        <span v-if="isLoading" class="inline-flex items-center gap-2">
          <Spinner />
          {{ t("models.loading") }}
        </span>
        <template v-else>
          {{
            view === "providers"
              ? t("providers.picker.empty")
              : isImagePurpose
                ? t("models.picker.imageEmpty")
                : t("models.picker.empty")
          }}
        </template>
      </CommandEmpty>

      <template v-if="view === 'models'">
        <CommandGroup>
          <CommandItem
            value="manage configure provider service model"
            @select="view = 'providers'"
          >
            <WrenchIcon aria-hidden="true" />
            {{ t("models.picker.manageServiceOrModel") }}
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />

        <template v-if="isImagePurpose">
          <CommandGroup
            v-for="group in imageModelGroups"
            :key="group.id"
            :heading="group.heading"
          >
            <CommandItem
              v-for="model in group.models"
              :key="`${model.providerId}:${model.id}`"
              :value="`${model.providerName} ${model.name} ${model.id}`"
              class="[&>svg:last-child]:hidden"
              @select="selectImageModel(model)"
            >
              <CheckIcon
                v-if="isImageModelSelected(model)"
                aria-hidden="true"
              />
              <ImageIcon v-else aria-hidden="true" />
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate">{{ model.name }}</span>
                <span
                  class="truncate text-xs font-normal text-muted-foreground"
                >
                  {{ model.id }}
                </span>
              </span>
            </CommandItem>
          </CommandGroup>
        </template>

        <CommandGroup
          v-for="group in modelGroups"
          v-else
          :key="group.id"
          :heading="group.heading"
        >
          <CommandItem
            v-for="model in group.models"
            :key="`${model.providerId}:${model.id}`"
            :value="`${model.providerName} ${model.name} ${model.id}`"
            class="[&>svg:last-child]:hidden"
            @select="selectModel(model)"
          >
            <CheckIcon v-if="isSelected(model)" aria-hidden="true" />
            <ProviderIcon
              v-else
              :provider-id="model.providerId"
              :provider-name="model.providerName"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate">{{ model.name }}</span>
              <span class="truncate text-xs font-normal text-muted-foreground">
                {{ model.id }}
              </span>
            </span>
            <span class="ml-auto flex shrink-0 items-center gap-1">
              <ModelCapabilities
                :model="model"
                :recommended="
                  purpose === 'session' && modelsStore.isRecommended(model)
                "
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                :aria-label="
                  modelsStore.isFavorite(model)
                    ? t('models.picker.removeFavorite', { model: model.name })
                    : t('models.picker.addFavorite', { model: model.name })
                "
                :aria-pressed="modelsStore.isFavorite(model)"
                @pointerdown.stop
                @click.stop="modelsStore.toggleFavorite(model)"
              >
                <HeartIcon
                  aria-hidden="true"
                  :class="
                    cn({
                      'fill-current': modelsStore.isFavorite(model),
                    })
                  "
                />
              </Button>
              <template
                v-if="model.isCustom && group.id.startsWith('provider:')"
              >
                <Button
                  type="button"
                  data-testid="custom-model-edit"
                  variant="ghost"
                  size="icon-xs"
                  :aria-label="t('models.picker.editCustomModel')"
                  :title="t('models.picker.editCustomModel')"
                  @pointerdown.stop
                  @click.stop="openCustomModelEditor(model)"
                >
                  <PencilIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  data-testid="custom-model-delete"
                  variant="ghost"
                  size="icon-xs"
                  :aria-label="t('models.picker.deleteCustomModel')"
                  :title="t('models.picker.deleteCustomModel')"
                  @pointerdown.stop
                  @click.stop="requestCustomDelete({ kind: 'model', model })"
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </template>
            </span>
          </CommandItem>
        </CommandGroup>
      </template>

      <template v-else>
        <CommandGroup>
          <CommandItem value="back models" @select="view = 'models'">
            <ArrowLeftIcon aria-hidden="true" />
            {{ t("models.picker.backToModels") }}
          </CommandItem>
          <CommandItem
            value="add custom model provider endpoint"
            @select="openCustomModel"
          >
            <PlusIcon aria-hidden="true" />
            {{ t("models.picker.addCustomModel") }}
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />

        <CommandGroup :heading="t('providers.picker.all')">
          <CommandItem
            v-for="provider in providers"
            :key="provider.id"
            :value="`${provider.name} ${provider.id}`"
            :disabled="
              !provider.isCustom &&
              !provider.configured &&
              !canConfigure(provider)
            "
            class="[&>svg:last-child]:hidden"
            @select="selectProvider(provider)"
          >
            <ProviderIcon
              :provider-id="provider.id"
              :provider-name="provider.name"
            />
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate">{{ provider.name }}</span>
              <span class="truncate text-xs font-normal text-muted-foreground">
                {{ provider.id }} ·
                {{ t("providers.modelCount", { count: provider.modelCount }) }}
              </span>
            </span>
            <span
              data-slot="provider-actions"
              class="ml-auto flex shrink-0 items-center gap-1"
            >
              <Badge v-if="provider.configured" variant="secondary">
                {{ t("providers.connected") }}
              </Badge>
              <template v-if="provider.isCustom">
                <Badge variant="outline">
                  {{ t("providers.custom.label") }}
                </Badge>
                <Button
                  type="button"
                  data-testid="custom-provider-edit"
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('providers.custom.edit')"
                  :title="t('providers.custom.edit')"
                  @pointerdown.stop
                  @click.stop="openCustomProviderEditor(provider)"
                >
                  <PencilIcon aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  data-testid="custom-provider-delete"
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="t('providers.custom.delete')"
                  :title="t('providers.custom.delete')"
                  @pointerdown.stop
                  @click.stop="
                    requestCustomDelete({ kind: 'provider', provider })
                  "
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </template>
              <Button
                v-if="provider.configured && !provider.isCustom"
                type="button"
                data-testid="provider-disconnect"
                variant="ghost"
                size="icon-sm"
                :aria-label="
                  t('providers.disconnect', { provider: provider.name })
                "
                :title="t('providers.disconnect', { provider: provider.name })"
                @pointerdown.stop
                @click.stop="requestDisconnect(provider)"
              >
                <UnplugIcon aria-hidden="true" />
              </Button>
            </span>
          </CommandItem>
        </CommandGroup>
      </template>
    </CommandList>
  </CommandDialog>

  <ProviderAuthDialog
    v-model:open="isAuthOpen"
    :provider="selectedProvider"
    @connected="handleConnected"
  />

  <CustomModelDialog
    :open="isCustomModelOpen"
    :model="editingCustomModel"
    @update:open="customModelOpenChanged"
    @saved="handleCustomModelSaved"
  />

  <CustomProviderDialog
    :open="isCustomProviderOpen"
    :provider="editingCustomProvider"
    @update:open="customProviderOpenChanged"
    @saved="handleCustomProviderSaved"
  />

  <AlertDialog
    :open="isDisconnectDialogOpen"
    @update:open="disconnectDialogOpenChanged"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{
            t("providers.disconnectTitle", {
              provider: disconnectingProvider?.name ?? "",
            })
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t("providers.disconnectDescription", {
              provider: disconnectingProvider?.name ?? "",
            })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDisconnecting">
          {{ t("common.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          data-testid="confirm-provider-disconnect"
          variant="destructive"
          :disabled="isDisconnecting"
          @click.prevent="disconnectProvider"
        >
          <Spinner v-if="isDisconnecting" data-icon="inline-start" />
          {{ t("providers.disconnectConfirm") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <AlertDialog
    :open="isCustomDeleteDialogOpen"
    @update:open="customDeleteDialogOpenChanged"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{
            customDeleteTarget?.kind === "provider"
              ? t("providers.custom.deleteTitle", {
                  provider: customDeleteTarget.provider.name,
                })
              : t("models.picker.deleteCustomModelTitle", {
                  model: customDeleteTarget?.model.name ?? "",
                })
          }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{
            customDeleteTarget?.kind === "provider"
              ? t("providers.custom.deleteDescription", {
                  provider: customDeleteTarget.provider.name,
                })
              : t("models.picker.deleteCustomModelDescription", {
                  model: customDeleteTarget?.model.name ?? "",
                })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDeletingCustom">
          {{ t("common.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          data-testid="confirm-custom-delete"
          variant="destructive"
          :disabled="isDeletingCustom"
          @click.prevent="deleteCustomTarget"
        >
          <Spinner v-if="isDeletingCustom" data-icon="inline-start" />
          {{ t("common.delete") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
