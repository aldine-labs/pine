<script setup lang="ts">
import {
  ArrowLeftIcon,
  CheckIcon,
  HeartIcon,
  PlusIcon,
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
  PineModelDescriptor,
  PineProviderDescriptor,
} from "@/shared/models";
import { pineModelKey, useModelsStore } from "@/stores/models";
import ModelCapabilities from "./ModelCapabilities.vue";
import CustomModelDialog from "./CustomModelDialog.vue";
import ProviderAuthDialog from "./ProviderAuthDialog.vue";
import ProviderIcon from "./ProviderIcon.vue";

type PickerView = "models" | "providers";

const props = withDefaults(
  defineProps<{
    open: boolean;
    purpose?: "session" | "utility";
    sessionId?: string;
  }>(),
  { purpose: "session" },
);
const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useI18n();
const modelsStore = useModelsStore();
const { isLoading, models, providers, utilitySelection } =
  storeToRefs(modelsStore);
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
const title = computed(() =>
  view.value === "models"
    ? t("models.picker.title")
    : t("providers.picker.title"),
);
const description = computed(() =>
  view.value === "models"
    ? t("models.picker.description")
    : t("providers.picker.description"),
);
const searchPlaceholder = computed(() =>
  view.value === "models"
    ? t("models.picker.searchPlaceholder")
    : t("providers.picker.searchPlaceholder"),
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
    props.purpose === "utility"
      ? utilitySelection.value
      : sessionSelection.value;
  return (
    selected?.providerId === model.providerId && selected.modelId === model.id
  );
}

function canConfigure(provider: PineProviderDescriptor): boolean {
  return provider.authMethods.length > 0;
}

async function openAuth(provider: PineProviderDescriptor): Promise<void> {
  selectedProvider.value = provider;
  emit("update:open", false);
  await nextTick();
  isAuthOpen.value = true;
}

async function openCustomModel(): Promise<void> {
  emit("update:open", false);
  await nextTick();
  isCustomModelOpen.value = true;
}

async function customModelOpenChanged(open: boolean): Promise<void> {
  isCustomModelOpen.value = open;
  if (open) return;
  await nextTick();
  emit("update:open", true);
}

async function handleCustomModelSaved(): Promise<void> {
  view.value = "models";
  isCustomModelOpen.value = false;
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

function selectProvider(provider: PineProviderDescriptor): void {
  if (!canConfigure(provider)) return;
  void openAuth(provider);
}

function requestDisconnect(provider: PineProviderDescriptor): void {
  disconnectingProvider.value = provider;
  isDisconnectDialogOpen.value = true;
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
            view === "models"
              ? t("models.picker.empty")
              : t("providers.picker.empty")
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

        <CommandGroup
          v-for="group in modelGroups"
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
            :disabled="!provider.configured && !canConfigure(provider)"
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
              <Button
                v-if="provider.configured"
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
    @update:open="customModelOpenChanged"
    @saved="handleCustomModelSaved"
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
</template>
