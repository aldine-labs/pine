<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type {
  PineCustomModelApi,
  PineProviderDescriptor,
} from "@/shared/models";
import { useModelsStore } from "@/stores/models";

const props = defineProps<{
  provider: PineProviderDescriptor | null;
}>();
const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();
const modelsStore = useModelsStore();
const { isLoading } = storeToRefs(modelsStore);
const isSaving = ref(false);
const hasAttemptedSave = ref(false);

const draft = reactive<{
  api: PineCustomModelApi;
  apiKey: string;
  baseUrl: string;
  providerName: string;
}>({
  api: "openai-completions",
  apiKey: "",
  baseUrl: "",
  providerName: "",
});

const isValid = computed(() => {
  try {
    const protocol = new URL(draft.baseUrl.trim()).protocol;
    return (
      draft.providerName.trim().length > 0 &&
      ["http:", "https:"].includes(protocol)
    );
  } catch {
    return false;
  }
});

watch(open, (isOpen) => {
  if (!isOpen) return;
  const provider = props.provider;
  Object.assign(draft, {
    api: provider?.api ?? "openai-completions",
    apiKey: "",
    baseUrl: provider?.baseUrl ?? "",
    providerName: provider?.name ?? "",
  });
  hasAttemptedSave.value = false;
});

function updateApi(value: unknown): void {
  if (
    value === "anthropic-messages" ||
    value === "google-generative-ai" ||
    value === "openai-completions" ||
    value === "openai-responses"
  ) {
    draft.api = value;
  }
}

async function save(): Promise<void> {
  hasAttemptedSave.value = true;
  if (!props.provider || !isValid.value || isSaving.value) return;
  isSaving.value = true;
  try {
    await modelsStore.updateCustomProvider({
      api: draft.api,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
      baseUrl: draft.baseUrl.trim(),
      providerId: props.provider.id,
      providerName: draft.providerName.trim(),
    });
    emit("saved");
  } catch (error) {
    handleError(error, {
      id: "models.update-custom-provider",
      title: t("errors.customProvider.title"),
      description: t("errors.customProvider.description"),
    });
  } finally {
    isSaving.value = false;
  }
}

const emit = defineEmits<{ saved: [] }>();
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent data-testid="custom-provider-dialog" class="sm:max-w-lg">
      <form class="flex flex-col gap-6" @submit.prevent="save">
        <DialogHeader>
          <DialogTitle>{{ t("providers.custom.editTitle") }}</DialogTitle>
          <DialogDescription>
            {{ t("providers.custom.editDescription") }}
          </DialogDescription>
        </DialogHeader>

        <FieldGroup class="gap-5">
          <Field>
            <FieldLabel for="custom-provider-edit-id">
              {{ t("models.custom.providerId") }}
            </FieldLabel>
            <Input
              id="custom-provider-edit-id"
              :model-value="provider?.id ?? ''"
              disabled
              spellcheck="false"
            />
            <FieldDescription>
              {{ t("providers.custom.idDescription") }}
            </FieldDescription>
          </Field>

          <Field :data-invalid="hasAttemptedSave && !isValid">
            <FieldLabel for="custom-provider-edit-name">
              {{ t("models.custom.providerName") }}
            </FieldLabel>
            <Input
              id="custom-provider-edit-name"
              v-model="draft.providerName"
              maxlength="200"
              :aria-invalid="hasAttemptedSave && !isValid"
            />
            <FieldError v-if="hasAttemptedSave && !isValid">
              {{ t("providers.custom.invalidDescription") }}
            </FieldError>
          </Field>

          <Field>
            <FieldLabel for="custom-provider-edit-base-url">
              {{ t("models.custom.baseUrl") }}
            </FieldLabel>
            <Input
              id="custom-provider-edit-base-url"
              v-model="draft.baseUrl"
              type="url"
              maxlength="2000"
              spellcheck="false"
            />
          </Field>

          <Field>
            <FieldLabel>{{ t("models.custom.api") }}</FieldLabel>
            <Select :model-value="draft.api" @update:model-value="updateApi">
              <SelectTrigger class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai-completions">
                  OpenAI Chat Completions
                </SelectItem>
                <SelectItem value="openai-responses">
                  OpenAI Responses
                </SelectItem>
                <SelectItem value="anthropic-messages">
                  Anthropic Messages
                </SelectItem>
                <SelectItem value="google-generative-ai">
                  Google Generative AI
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel for="custom-provider-edit-api-key">
              {{ t("models.custom.apiKey") }}
            </FieldLabel>
            <Input
              id="custom-provider-edit-api-key"
              v-model="draft.apiKey"
              type="password"
              maxlength="100000"
              autocomplete="off"
              spellcheck="false"
              :placeholder="
                provider?.hasApiKey
                  ? t('providers.custom.apiKeyPlaceholder')
                  : t('models.custom.apiKeyPlaceholder')
              "
            />
            <FieldDescription>
              {{ t("providers.custom.apiKeyDescription") }}
            </FieldDescription>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            :disabled="isSaving || isLoading"
            @click="open = false"
          >
            {{ t("common.cancel") }}
          </Button>
          <Button type="submit" :disabled="isSaving || isLoading">
            <Spinner v-if="isSaving" data-icon="inline-start" />
            {{ isSaving ? t("common.saving") : t("providers.custom.save") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
