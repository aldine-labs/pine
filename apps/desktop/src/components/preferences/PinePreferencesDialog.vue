<script setup lang="ts">
import { handleError } from "@/app/errors/errorHandler";
import { CircleHelpIcon, PencilIcon, SettingsIcon } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { isAppLocale, persistAppLocale } from "@/app/i18n";
import ModelPickerDialog from "@/components/models/ModelPickerDialog.vue";
import UserProfileDialog from "@/components/preferences/UserProfileDialog.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useModelsStore } from "@/stores/models";
import { isThemePreference, useAppearanceStore } from "@/stores/appearance";
import {
  DEFAULT_CONTEXT_COMPACTION_STRATEGY,
  isPineContextCompactionStrategy,
  type PineContextCompactionStrategy,
} from "@/shared/preferences";

const { locale, t } = useI18n();
const appearanceStore = useAppearanceStore();
const modelsStore = useModelsStore();
const { supportsSidebarVibrancy, themePreference } =
  storeToRefs(appearanceStore);
const { utilitySelectedModel } = storeToRefs(modelsStore);
const isOpen = ref(false);
const isUtilityModelPickerOpen = ref(false);
const isUserProfileDialogOpen = ref(false);
const isTinyFishCredentialDialogOpen = ref(false);
const isTinyFishCredentialConfigured = ref(false);
const tinyFishApiKey = ref("");
const isSavingTinyFishApiKey = ref(false);
const contextCompactionStrategy = ref<PineContextCompactionStrategy>(
  DEFAULT_CONTEXT_COMPACTION_STRATEGY,
);
const isSavingContextCompactionStrategy = ref(false);
const canSaveTinyFishApiKey = computed(
  () => tinyFishApiKey.value.trim().length > 0 && !isSavingTinyFishApiKey.value,
);

watch(isOpen, (open) => {
  if (!open) return;
  void modelsStore.load();
  void loadTinyFishCredentialStatus();
  void loadContextCompactionStrategy();
});

onMounted(() => {
  void loadTinyFishCredentialStatus();
  void loadContextCompactionStrategy();
});

async function loadContextCompactionStrategy(): Promise<void> {
  if (typeof window.pine?.getContextCompactionStrategy !== "function") return;
  try {
    contextCompactionStrategy.value =
      await window.pine.getContextCompactionStrategy();
  } catch (error) {
    handleError(error, {
      id: "context-compaction-strategy-load",
      title: t("errors.contextCompactionStrategy.title"),
      description: t("errors.contextCompactionStrategy.description"),
    });
  }
}

async function updateContextCompactionStrategy(value: unknown): Promise<void> {
  if (
    !isPineContextCompactionStrategy(value) ||
    value === contextCompactionStrategy.value ||
    isSavingContextCompactionStrategy.value
  ) {
    return;
  }
  const previous = contextCompactionStrategy.value;
  contextCompactionStrategy.value = value;
  isSavingContextCompactionStrategy.value = true;
  try {
    await window.pine.setContextCompactionStrategy({ strategy: value });
  } catch (error) {
    contextCompactionStrategy.value = previous;
    handleError(error, {
      id: "context-compaction-strategy-save",
      title: t("errors.contextCompactionStrategy.title"),
      description: t("errors.contextCompactionStrategy.description"),
    });
  } finally {
    isSavingContextCompactionStrategy.value = false;
  }
}

async function loadTinyFishCredentialStatus(): Promise<void> {
  if (typeof window.pine?.getTinyFishCredentialStatus !== "function") return;
  try {
    const status = await window.pine.getTinyFishCredentialStatus();
    isTinyFishCredentialConfigured.value = status.configured;
  } catch (error) {
    handleError(error, {
      id: "tinyfish-credential-status",
      title: t("errors.tinyFishCredentials.title"),
      description: t("errors.tinyFishCredentials.description"),
    });
  }
}

function openTinyFishCredentialDialog(): void {
  tinyFishApiKey.value = "";
  isTinyFishCredentialDialogOpen.value = true;
}

async function saveTinyFishApiKey(): Promise<void> {
  if (!canSaveTinyFishApiKey.value) return;
  isSavingTinyFishApiKey.value = true;
  try {
    const result = await window.pine.setTinyFishApiKey({
      apiKey: tinyFishApiKey.value.trim(),
    });
    isTinyFishCredentialConfigured.value = result.configured;
    tinyFishApiKey.value = "";
    isTinyFishCredentialDialogOpen.value = false;
  } catch (error) {
    handleError(error, {
      id: "tinyfish-credential-save",
      title: t("errors.tinyFishCredentials.title"),
      description: t("errors.tinyFishCredentials.description"),
    });
  } finally {
    isSavingTinyFishApiKey.value = false;
  }
}

function updateLocale(value: unknown): void {
  if (typeof value !== "string" || !isAppLocale(value)) return;

  locale.value = value;
  document.documentElement.lang = value;
  persistAppLocale(value);
}

function updateTheme(value: unknown): void {
  if (typeof value !== "string" || !isThemePreference(value)) return;
  appearanceStore.setThemePreference(value);
}

function updateSidebarVibrancy(value: boolean): void {
  appearanceStore.setSidebarVibrancy(value);
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogTrigger as-child>
      <Button
        data-slot="pine-preferences-trigger"
        variant="ghost"
        size="icon-sm"
        :aria-label="t('preferences.open')"
        :title="t('preferences.open')"
      >
        <SettingsIcon />
      </Button>
    </DialogTrigger>

    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ t("preferences.title") }}</DialogTitle>
      </DialogHeader>

      <FieldGroup>
        <Field orientation="horizontal">
          <FieldTitle id="pine-language-setting">
            {{ t("preferences.language") }}
          </FieldTitle>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            :model-value="locale"
            aria-labelledby="pine-language-setting"
            @update:model-value="updateLocale"
          >
            <ToggleGroupItem value="zh-CN">
              {{ t("preferences.languageChinese") }}
            </ToggleGroupItem>
            <ToggleGroupItem value="en-US">
              {{ t("preferences.languageEnglish") }}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field orientation="horizontal">
          <FieldTitle id="pine-appearance-setting">
            {{ t("preferences.appearance") }}
          </FieldTitle>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            :model-value="themePreference"
            aria-labelledby="pine-appearance-setting"
            @update:model-value="updateTheme"
          >
            <ToggleGroupItem value="system">
              {{ t("preferences.themeSystem") }}
            </ToggleGroupItem>
            <ToggleGroupItem value="light">
              {{ t("preferences.themeLight") }}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
              {{ t("preferences.themeDark") }}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field orientation="horizontal">
          <div class="flex min-w-0 flex-1 items-baseline gap-2">
            <FieldTitle id="pine-context-compaction-strategy-setting">
              {{ t("preferences.contextCompactionStrategy") }}
            </FieldTitle>
            <TooltipProvider :delay-duration="300">
              <Tooltip>
                <TooltipTrigger as-child>
                  <Badge
                    as="button"
                    type="button"
                    variant="secondary"
                    class="size-5 translate-y-px p-0"
                    :aria-label="t('preferences.contextCompactionStrategyHelp')"
                  >
                    <CircleHelpIcon aria-hidden="true" />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" :side-offset="4">
                  {{ t("preferences.contextCompactionStrategyDescription") }}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            :disabled="isSavingContextCompactionStrategy"
            :model-value="contextCompactionStrategy"
            aria-labelledby="pine-context-compaction-strategy-setting"
            @update:model-value="updateContextCompactionStrategy"
          >
            <ToggleGroupItem value="passive">
              {{ t("preferences.contextCompactionPassive") }}
            </ToggleGroupItem>
            <ToggleGroupItem value="recommended">
              {{ t("preferences.contextCompactionRecommended") }}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field orientation="horizontal">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <FieldTitle id="pine-user-profile-setting">
              {{ t("preferences.userProfile") }}
            </FieldTitle>
            <FieldDescription>
              {{ t("preferences.userProfileDescription") }}
            </FieldDescription>
          </div>
          <Button
            data-testid="pine-user-profile-edit-button"
            variant="outline"
            size="sm"
            aria-labelledby="pine-user-profile-setting"
            @click="isUserProfileDialogOpen = true"
          >
            <PencilIcon data-icon="inline-start" />
            {{ t("common.edit") }}
          </Button>
        </Field>

        <Field orientation="horizontal">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <FieldTitle id="pine-utility-model-setting">
              {{ t("preferences.utilityModel") }}
            </FieldTitle>
            <FieldDescription>
              {{
                utilitySelectedModel?.name ??
                t("preferences.noUtilityModelSelected")
              }}
            </FieldDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-labelledby="pine-utility-model-setting"
            @click="isUtilityModelPickerOpen = true"
          >
            {{ t("preferences.selectUtilityModel") }}
          </Button>
        </Field>

        <Field orientation="horizontal">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <FieldTitle id="pine-tinyfish-credential-setting">
              {{ t("preferences.tinyFish") }}
            </FieldTitle>
            <FieldDescription>
              {{ t("preferences.tinyFishDescription") }}
            </FieldDescription>
          </div>
          <Button
            data-testid="pine-tinyfish-credential-button"
            variant="outline"
            size="sm"
            aria-labelledby="pine-tinyfish-credential-setting"
            @click="openTinyFishCredentialDialog"
          >
            {{
              isTinyFishCredentialConfigured
                ? t("preferences.changeTinyFishApiKey")
                : t("preferences.addTinyFishApiKey")
            }}
          </Button>
        </Field>

        <Field v-if="supportsSidebarVibrancy" orientation="horizontal">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <FieldTitle id="pine-sidebar-vibrancy-setting">
              {{ t("preferences.sidebarVibrancy") }}
            </FieldTitle>
            <FieldDescription>
              {{ t("preferences.sidebarVibrancyDescription") }}
            </FieldDescription>
          </div>
          <Switch
            data-testid="pine-sidebar-vibrancy-toggle"
            :model-value="appearanceStore.sidebarVibrancy"
            aria-labelledby="pine-sidebar-vibrancy-setting"
            @update:model-value="updateSidebarVibrancy"
          />
        </Field>
      </FieldGroup>
    </DialogContent>
  </Dialog>

  <UserProfileDialog v-model:open="isUserProfileDialogOpen" />

  <Dialog v-model:open="isTinyFishCredentialDialogOpen">
    <DialogContent class="sm:max-w-md">
      <form @submit.prevent="saveTinyFishApiKey">
        <DialogHeader>
          <DialogTitle>
            {{ t("preferences.tinyFishDialogTitle") }}
          </DialogTitle>
        </DialogHeader>

        <FieldGroup class="py-4">
          <Field>
            <FieldLabel for="tinyfish-api-key">
              {{ t("preferences.tinyFishApiKeyLabel") }}
            </FieldLabel>
            <Input
              id="tinyfish-api-key"
              v-model="tinyFishApiKey"
              type="password"
              autocomplete="new-password"
              :placeholder="t('preferences.tinyFishApiKeyPlaceholder')"
              :disabled="isSavingTinyFishApiKey"
            />
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="isSavingTinyFishApiKey"
            @click="isTinyFishCredentialDialogOpen = false"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button type="submit" :disabled="!canSaveTinyFishApiKey">
            {{
              isSavingTinyFishApiKey
                ? t("common.saving")
                : t("preferences.saveTinyFishApiKey")
            }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>

  <ModelPickerDialog
    v-model:open="isUtilityModelPickerOpen"
    purpose="utility"
  />
</template>
