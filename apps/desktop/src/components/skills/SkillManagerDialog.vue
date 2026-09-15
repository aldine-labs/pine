<script setup lang="ts">
import { PlusIcon, Trash2Icon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
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
const activeScope = ref<PineSkillScope>("global");
const skills = ref<PineSkillSummary[]>([]);
const selectedName = ref("");
const content = ref("");
const isCreating = ref(false);
const isLoading = ref(false);
const isSaving = ref(false);
const togglingNames = ref(new Set<string>());
const canSave = computed(
  () =>
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selectedName.value) &&
    selectedName.value.length <= 64 &&
    content.value.trim().length > 0 &&
    !isSaving.value,
);

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

async function load(): Promise<void> {
  isLoading.value = true;
  try {
    skills.value = (await window.pine.listSkills(scopeRequest())).skills;
    const current = skills.value.find(
      (skill) => skill.name === selectedName.value,
    );
    if (current) await selectSkill(current.name);
    else if (skills.value[0]) await selectSkill(skills.value[0].name);
    else startCreating();
  } catch (error) {
    reportError(error, "load");
  } finally {
    isLoading.value = false;
  }
}

async function selectSkill(name: string): Promise<void> {
  selectedName.value = name;
  isCreating.value = false;
  content.value = (
    await window.pine.readSkill({ ...scopeRequest(), name })
  ).content;
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
  content.value = `---\nname: \ndescription: \n---\n\n# Skill\n\n`;
  isCreating.value = true;
}

function syncFrontmatterName(name: string): void {
  selectedName.value = name.trim().toLowerCase();
  if (isCreating.value) {
    content.value = content.value.replace(
      /^name:\s*.*$/m,
      `name: ${selectedName.value}`,
    );
  }
}

async function save(): Promise<void> {
  if (!canSave.value) return;
  isSaving.value = true;
  try {
    const request = {
      ...scopeRequest(),
      name: selectedName.value,
      content: content.value,
    };
    if (isCreating.value) await window.pine.createSkill(request);
    else await window.pine.editSkill(request);
    isCreating.value = false;
    await load();
  } catch (error) {
    reportError(error, "save");
  } finally {
    isSaving.value = false;
  }
}

async function removeSelected(): Promise<void> {
  if (!selectedName.value || isCreating.value) return;
  try {
    await window.pine.removeSkill({
      ...scopeRequest(),
      name: selectedName.value,
    });
    selectedName.value = "";
    await load();
  } catch (error) {
    reportError(error, "remove");
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
  if (value) void load();
});

watch(activeScope, () => {
  if (!open.value) return;
  selectedName.value = "";
  void load();
});
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="max-h-[min(88vh,48rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
    >
      <DialogHeader class="px-6 pt-6 pb-4 pr-16">
        <DialogTitle>{{ t("skills.title") }}</DialogTitle>
        <DialogDescription>{{ t("skills.description") }}</DialogDescription>
      </DialogHeader>

      <Tabs v-model="activeScope" class="flex min-h-0 flex-1 flex-col">
        <div class="px-6 pb-4">
          <TabsList class="grid w-full grid-cols-2">
            <TabsTrigger value="global">
              {{ t("skills.scope.global") }}
            </TabsTrigger>
            <TabsTrigger value="project">
              {{ t("skills.scope.project") }}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          :value="activeScope"
          class="grid min-h-0 flex-1 grid-cols-[14rem_1fr] border-y"
        >
          <div class="flex min-h-0 flex-col border-r bg-muted/20">
            <div class="p-3">
              <Button
                class="w-full"
                variant="outline"
                size="sm"
                @click="startCreating"
              >
                <PlusIcon data-icon="inline-start" />
                {{ t("skills.new") }}
              </Button>
            </div>
            <ScrollArea class="min-h-0 flex-1 px-2 pb-3">
              <div
                v-for="skill in skills"
                :key="skill.name"
                class="mb-1 flex items-center rounded-md hover:bg-muted"
                :class="
                  skill.name === selectedName && !isCreating ? 'bg-muted' : ''
                "
              >
                <button
                  type="button"
                  class="min-w-0 flex-1 px-3 py-2 text-left"
                  @click="selectSkillSafely(skill.name)"
                >
                  <span class="block truncate font-medium">{{
                    skill.name
                  }}</span>
                  <span class="line-clamp-2 text-xs text-muted-foreground">
                    {{ skill.description }}
                  </span>
                </button>
                <Switch
                  v-if="activeScope === 'global'"
                  class="mr-3 shrink-0"
                  :model-value="skill.enabled !== false"
                  :disabled="togglingNames.has(skill.name)"
                  :aria-label="
                    t('skills.globalEnabledLabel', { name: skill.name })
                  "
                  @update:model-value="setGlobalSkillEnabled(skill, $event)"
                />
              </div>
              <p
                v-if="!isLoading && skills.length === 0"
                class="px-3 py-6 text-center text-sm text-muted-foreground"
              >
                {{ t("skills.empty") }}
              </p>
            </ScrollArea>
          </div>

          <div class="flex min-h-0 flex-col gap-4 p-5">
            <div class="flex items-center gap-2">
              <Input
                :model-value="selectedName"
                :disabled="!isCreating"
                :placeholder="t('skills.namePlaceholder')"
                @update:model-value="syncFrontmatterName(String($event))"
              />
              <Badge variant="secondary">{{
                t(`skills.scope.${activeScope}`)
              }}</Badge>
            </div>
            <Textarea
              v-model="content"
              class="min-h-80 flex-1 resize-none font-mono text-xs"
              spellcheck="false"
              :placeholder="t('skills.contentPlaceholder')"
            />
            <div class="flex justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                :disabled="isCreating || !selectedName"
                @click="removeSelected"
              >
                <Trash2Icon data-icon="inline-start" />
                {{ t("common.delete") }}
              </Button>
              <Button
                type="button"
                size="sm"
                :disabled="!canSave"
                @click="save"
              >
                {{ isSaving ? t("common.saving") : t("common.save") }}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <DialogFooter class="px-6 py-4">
        <Button variant="outline" @click="open = false">
          {{ t("common.done") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
