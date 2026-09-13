<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import MarkdownContent from "@/components/markdown/MarkdownContent.vue";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import type { PinePendingQuestionnaire } from "@/stores/session";

const props = defineProps<{
  questionnaire: PinePendingQuestionnaire;
}>();

const emit = defineEmits<{
  respond: [submission: AskUserQuestionSubmission];
}>();

const { t } = useI18n();
const customAnswers = ref<Record<number, string>>({});
const selectedPreviews = ref<Record<number, string | undefined>>({});
const responded = ref(false);

const items = props.questionnaire.questionnaire.questions.map(
  (question, questionIndex) => ({
    name: `question-${questionIndex}`,
    required: true,
    choices: question.options.map((_, optionIndex) => ({
      value: `option:${optionIndex}`,
    })),
  }),
);

function respond(submission: AskUserQuestionSubmission): void {
  if (responded.value) return;
  responded.value = true;
  emit("respond", submission);
}

function handleChoiceChange(
  questionIndex: number,
  optionIndex: number,
  event: Event,
): void {
  const question = props.questionnaire.questionnaire.questions[questionIndex];
  if (question?.multiSelect || !(event.target instanceof HTMLInputElement)) {
    return;
  }
  if (event.target.checked) {
    customAnswers.value[questionIndex] = "";
    selectedPreviews.value[questionIndex] =
      question.options[optionIndex]?.preview;
  }
}

function handleCustomAnswer(questionIndex: number, value: string): void {
  customAnswers.value[questionIndex] = value;
  if (value.trim()) selectedPreviews.value[questionIndex] = undefined;
}

function handleSubmit(event: Event): void {
  event.preventDefault();
  const formData = new FormData(event.target as HTMLFormElement);
  respond({
    cancelled: false,
    answers: props.questionnaire.questionnaire.questions.map(
      (_, questionIndex) => {
        const values = formData.getAll(`question-${questionIndex}`).map(String);
        return {
          questionIndex,
          selectedOptionIndexes: values.flatMap((value) => {
            const match = /^option:(\d+)$/.exec(value);
            return match ? [Number(match[1])] : [];
          }),
          ...(customAnswers.value[questionIndex]?.trim()
            ? { customAnswer: customAnswers.value[questionIndex].trim() }
            : {}),
        };
      },
    ),
  });
}

function cancel(): void {
  respond({ answers: [], cancelled: true });
}
</script>

<template>
  <Card data-slot="questionnaire-card">
    <Questionnaire
      :key="questionnaire.requestId"
      :items="items"
      shortcuts="letters"
      @submit="handleSubmit"
    >
      <CardHeader>
        <div class="flex items-center justify-between gap-3">
          <CardTitle>{{ t("project.questionnaireRequest.title") }}</CardTitle>
          <QuestionnaireProgress v-slot="{ current, total }">
            {{ t("project.questionnaireRequest.progress", { current, total }) }}
          </QuestionnaireProgress>
        </div>
        <CardDescription>
          {{ t("project.questionnaireRequest.description") }}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <QuestionnaireItem
          v-for="(question, questionIndex) in questionnaire.questionnaire
            .questions"
          :key="questionIndex"
          :name="`question-${questionIndex}`"
          :multiple="question.multiSelect"
          required
        >
          <QuestionnaireTitle>{{ question.question }}</QuestionnaireTitle>
          <QuestionnaireDescription>
            {{ question.header }}
          </QuestionnaireDescription>
          <QuestionnaireChoices>
            <QuestionnaireChoice
              v-for="(option, optionIndex) in question.options"
              :key="optionIndex"
              :value="`option:${optionIndex}`"
              @change="handleChoiceChange(questionIndex, optionIndex, $event)"
            >
              <span class="font-medium">{{ option.label }}</span>
              <QuestionnaireChoiceDescription>
                {{ option.description }}
              </QuestionnaireChoiceDescription>
            </QuestionnaireChoice>
            <QuestionnaireInput
              :model-value="customAnswers[questionIndex] ?? ''"
              :aria-label="t('project.questionnaireRequest.customAnswer')"
              :placeholder="t('project.questionnaireRequest.customAnswer')"
              @update:model-value="handleCustomAnswer(questionIndex, $event)"
            />
          </QuestionnaireChoices>
          <div
            v-if="selectedPreviews[questionIndex]"
            class="mt-3 max-h-52 overflow-auto rounded-lg bg-muted/60 p-3"
          >
            <MarkdownContent
              :source="selectedPreviews[questionIndex] ?? ''"
              final
            />
          </div>
          <QuestionnaireError>
            {{ t("project.questionnaireRequest.required") }}
          </QuestionnaireError>
        </QuestionnaireItem>
      </CardContent>

      <CardFooter>
        <QuestionnaireActions>
          <QuestionnairePrevious>
            {{ t("project.questionnaireRequest.previous") }}
          </QuestionnairePrevious>
          <Button type="button" variant="ghost" @click="cancel">
            {{ t("project.questionnaireRequest.cancel") }}
          </Button>
          <QuestionnaireNext>
            {{ t("project.questionnaireRequest.next") }}
          </QuestionnaireNext>
          <QuestionnaireSubmit>
            {{ t("project.questionnaireRequest.submit") }}
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </CardFooter>
    </Questionnaire>
  </Card>
</template>
