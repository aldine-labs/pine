<script setup lang="ts">
import { PlusIcon, Trash2Icon } from "@lucide/vue";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { computed, ref, watch } from "vue";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { PineSkillScope, PineSkillSummary } from "@/shared/skills";

interface Props {
  projectId: string;
}

const props = defineProps<Props>();
const open = defineModel<boolean>("open", { default: false });
const { t } = useI18n();
const skillScopes = ["global", "project"] as const;
const activeScope = ref<PineSkillScope>("global");
const skills = ref<PineSkillSummary[]>([]);
const selectedName = ref("");
const description = ref("");
const body = ref("");
const frontmatter = ref<Record<string, unknown>>({});
const isCreating = ref(false);
const isLoading = ref(false);
const isSaving = ref(false);
const isDeleteConfirmOpen = ref(false);
const isRemoving = ref(false);
const deleteName = ref("");
const togglingNames = ref(new Set<string>());
const canSave = computed(
  () =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selectedName.value) &&
    selectedName.value.length <= 64 &&
    description.value.trim().length > 0 &&
    description.value.trim().length <= 1_024 &&
    body.value.trim().length > 0 &&
    !isSaving.value,
);

interface ParsedSkillDocument {
  body: string;
  frontmatter: Record<string, unknown>;
}

function parseSkillDocument(rawContent: string): ParsedSkillDocument {
  const normalized = rawContent
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { body: normalized.trim(), frontmatter: {} };
  }

  const endIndex = normalized.indexOf("\n---", 4);
  if (endIndex < 0) return { body: normalized.trim(), frontmatter: {} };

  try {
    const parsed = parseYaml(normalized.slice(4, endIndex));
    const metadata =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return {
      body: normalized.slice(endIndex + 4).trim(),
      frontmatter: metadata,
    };
  } catch {
    return { body: normalized.slice(endIndex + 4).trim(), frontmatter: {} };
  }
}

function serializeSkillDocument(): string {
  const metadata = {
    ...frontmatter.value,
    name: selectedName.value,
    description: description.value.trim(),
  };
  const header = stringifyYaml(metadata).trimEnd();
  const instructions = body.value.trim();
  return `---\n${header}\n---\n\n${instructions}\n`;
}

function scopeRequest(scope = activeScope.value) {
  return { projectId: props.projectId, scope };
}

function reportError(error: unknown, operation: "load" | "save" | "remove") {
  handleError(error, {
    id: `skills.${operation}`,
    title: t("errors.skills.title"),
    description: t("errors.skills.description"),
  });
}

async function load(nameToSelect?: string): Promise<void> {
  isLoading.value = true;
  try {
    skills.value = (await window.pine.listSkills(scopeRequest())).skills;
    if (
      nameToSelect &&
      skills.value.some((skill) => skill.name === nameToSelect)
    ) {
      await selectSkill(nameToSelect);
    }
  } catch (error) {
    reportError(error, "load");
  } finally {
    isLoading.value = false;
  }
}

async function selectSkill(name: string): Promise<void> {
  const result = await window.pine.readSkill({ ...scopeRequest(), name });
  const parsed = parseSkillDocument(result.content);
  selectedName.value = result.skill.name;
  description.value =
    typeof parsed.frontmatter.description === "string"
      ? parsed.frontmatter.description
      : result.skill.description;
  body.value = parsed.body;
  frontmatter.value = parsed.frontmatter;
  isCreating.value = false;
}

async function selectSkillSafely(name: string): Promise<void> {
  try {
    await selectSkill(name);
  } catch (error) {
    reportError(error, "load");
  }
}

function startCreating(): void {
  selectedName.value = "";
  description.value = "";
  body.value = "";
  frontmatter.value = {};
  isCreating.value = true;
}

function updateName(name: string | number): void {
  selectedName.value = String(name).trim().toLowerCase();
}

async function save(): Promise<void> {
  if (!canSave.value) return;
  isSaving.value = true;
  try {
    const request = {
      ...scopeRequest(),
      name: selectedName.value,
      content: serializeSkillDocument(),
    };
    if (isCreating.value) await window.pine.createSkill(request);
    else await window.pine.editSkill(request);
    const savedName = selectedName.value;
    isCreating.value = false;
    await load(savedName);
  } catch (error) {
    reportError(error, "save");
  } finally {
    isSaving.value = false;
  }
}

function removeSelected(): void {
  if (!selectedName.value || isCreating.value) return;
  deleteName.value = selectedName.value;
  isDeleteConfirmOpen.value = true;
}

async function confirmRemoveSelected(): Promise<void> {
  const name = deleteName.value;
  if (!name || isRemoving.value) return;
  isRemoving.value = true;
  try {
    await window.pine.removeSkill({
      ...scopeRequest(),
      name,
    });
    isDeleteConfirmOpen.value = false;
    startCreating();
    await load();
  } catch (error) {
    reportError(error, "remove");
  } finally {
    isRemoving.value = false;
  }
}

async function setGlobalSkillEnabled(
  skill: PineSkillSummary,
  enabled: boolean,
): Promise<void> {
  if (togglingNames.value.has(skill.name)) return;
  togglingNames.value = new Set(togglingNames.value).add(skill.name);
  const previous = skill.enabled !== false;
  skill.enabled = enabled;
  try {
    await window.pine.setGlobalSkillEnabled({
      enabled,
      name: skill.name,
      projectId: props.projectId,
    });
  } catch (error) {
    skill.enabled = previous;
    reportError(error, "save");
  } finally {
    const next = new Set(togglingNames.value);
    next.delete(skill.name);
    togglingNames.value = next;
  }
}

watch(open, (value) => {
  if (!value) return;
  startCreating();
  void load();
});

watch(activeScope, () => {
  if (!open.value) return;
  skills.value = [];
  startCreating();
  void load();
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="gap-0 overflow-hidden p-0 sm:max-w-3xl">
      <DialogHeader class="px-6 pt-6 pb-4 pr-16">
        <DialogTitle>{{ t("skills.title") }}</DialogTitle>
        <DialogDescription>{{ t("skills.description") }}</DialogDescription>
      </DialogHeader>

      <Tabs v-model="activeScope" class="min-h-0 gap-0">
        <div class="px-6 pb-4">
          <TabsList class="w-full">
            <TabsTrigger value="global">
              {{ t("skills.scope.global") }}
            </TabsTrigger>
            <TabsTrigger value="project">
              {{ t("skills.scope.project") }}
            </TabsTrigger>
          </TabsList>
        </div>

        <Separator />

        <template v-for="scope in skillScopes" :key="scope">
          <TabsContent
            v-if="scope === activeScope"
            :value="scope"
            class="m-0 h-[35rem] min-h-0 flex-none overflow-hidden"
          >
            <div
              class="grid h-full min-h-0 grid-cols-[14rem_auto_minmax(0,1fr)] overflow-hidden"
            >
              <aside class="min-h-0 overflow-hidden bg-muted/20">
                <ScrollArea
                  class="h-full min-h-0 overflow-hidden [&_[data-slot=scroll-area-viewport]]:scroll-fade-y"
                >
                  <ItemGroup class="gap-2 p-3">
                    <Item
                      as="button"
                      type="button"
                      variant="muted"
                      size="sm"
                      class="min-h-20 justify-center hover:bg-muted"
                      @click="startCreating"
                    >
                      <ItemMedia variant="icon">
                        <PlusIcon />
                      </ItemMedia>
                      <ItemContent class="flex-none">
                        <ItemTitle>{{ t("skills.new") }}</ItemTitle>
                      </ItemContent>
                    </Item>
                    <Item
                      v-for="skill in skills"
                      :key="skill.name"
                      :variant="
                        skill.name === selectedName && !isCreating
                          ? 'muted'
                          : 'default'
                      "
                      size="sm"
                      role="listitem"
                      class="min-w-0 hover:bg-muted"
                    >
                      <ItemContent class="min-w-0">
                        <button
                          type="button"
                          class="min-w-0 text-left"
                          @click="selectSkillSafely(skill.name)"
                        >
                          <ItemTitle class="w-full">{{ skill.name }}</ItemTitle>
                          <ItemDescription>
                            {{ skill.description }}
                          </ItemDescription>
                        </button>
                      </ItemContent>
                      <ItemActions
                        v-if="scope === 'global'"
                        class="mr-1 shrink-0"
                      >
                        <Switch
                          :model-value="skill.enabled !== false"
                          :disabled="togglingNames.has(skill.name)"
                          :aria-label="
                            t('skills.globalEnabledLabel', { name: skill.name })
                          "
                          @update:model-value="
                            setGlobalSkillEnabled(skill, $event)
                          "
                        />
                      </ItemActions>
                    </Item>
                  </ItemGroup>
                </ScrollArea>
              </aside>

              <Separator orientation="vertical" />

              <form
                class="flex h-full min-h-0 flex-col p-5"
                @submit.prevent="save"
              >
                <FieldGroup class="grid grid-cols-2 gap-2">
                  <Field class="gap-0">
                    <FieldLabel :for="`skill-${scope}-name`" class="sr-only">
                      {{ t("skills.nameLabel") }}
                    </FieldLabel>
                    <Input
                      :id="`skill-${scope}-name`"
                      :model-value="selectedName"
                      :disabled="!isCreating"
                      :placeholder="t('skills.namePlaceholder')"
                      @update:model-value="updateName"
                    />
                  </Field>
                  <Field class="gap-0">
                    <FieldLabel
                      :for="`skill-${scope}-description`"
                      class="sr-only"
                    >
                      {{ t("skills.descriptionLabel") }}
                    </FieldLabel>
                    <Input
                      :id="`skill-${scope}-description`"
                      v-model="description"
                      :placeholder="t('skills.descriptionPlaceholder')"
                    />
                  </Field>
                </FieldGroup>

                <Field class="mt-4 h-[26rem] min-h-0 gap-0">
                  <FieldLabel :for="`skill-${scope}-body`" class="sr-only">
                    {{ t("skills.instructionsLabel") }}
                  </FieldLabel>
                  <Textarea
                    :id="`skill-${scope}-body`"
                    v-model="body"
                    class="h-full min-h-0 overflow-y-auto [field-sizing:fixed] font-mono text-xs"
                    spellcheck="false"
                    :placeholder="t('skills.contentPlaceholder')"
                  />
                </Field>

                <DialogFooter
                  class="mt-4 flex-row justify-between sm:justify-between"
                >
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    :disabled="isCreating || !selectedName"
                    @click="removeSelected"
                  >
                    <Trash2Icon data-icon="inline-start" />
                    {{ t("common.delete") }}
                  </Button>
                  <Button type="submit" size="sm" :disabled="!canSave">
                    {{
                      isSaving
                        ? t("common.saving")
                        : isCreating
                          ? t("skills.create")
                          : t("common.save")
                    }}
                  </Button>
                </DialogFooter>
              </form>
            </div>
          </TabsContent>
        </template>
      </Tabs>
    </DialogContent>
  </Dialog>

  <AlertDialog v-model:open="isDeleteConfirmOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("skills.deleteTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("skills.deleteDescription", { name: deleteName }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isRemoving">
          {{ t("common.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          :disabled="isRemoving"
          @click="confirmRemoveSelected"
        >
          {{ t("common.delete") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
