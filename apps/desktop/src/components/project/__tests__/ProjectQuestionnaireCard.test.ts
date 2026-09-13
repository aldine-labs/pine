import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ProjectQuestionnaireCard from "../ProjectQuestionnaireCard.vue";

function mountCard() {
  return mount(ProjectQuestionnaireCard, {
    props: {
      questionnaire: {
        requestId: "019cfe51-7166-79b9-a5b9-c652fcca9eab",
        toolCallId: "tool-1",
        questionnaire: {
          questions: [
            {
              header: "Approach",
              question: "How should Pine proceed?",
              options: [
                {
                  label: "Small patch",
                  description: "Keep the implementation narrow.",
                  preview: "**Small** preview",
                },
                {
                  label: "Full adapter",
                  description: "Build a reusable package boundary.",
                },
              ],
            },
          ],
        },
      },
    },
    global: {
      plugins: [createAppI18n("en-US")],
      stubs: {
        MarkdownContent: {
          props: ["source"],
          template: '<div data-slot="markdown-stub">{{ source }}</div>',
        },
      },
    },
  });
}

describe("ProjectQuestionnaireCard", () => {
  it("submits a selected authored option and shows its preview", async () => {
    const wrapper = mountCard();
    await wrapper.findAll('input[type="radio"]')[0].setValue(true);
    await flushPromises();

    expect(wrapper.get('[data-slot="markdown-stub"]').text()).toBe(
      "**Small** preview",
    );
    await wrapper.get("form").trigger("submit");

    expect(wrapper.emitted("respond")).toEqual([
      [
        {
          cancelled: false,
          answers: [
            {
              questionIndex: 0,
              selectedOptionIndexes: [0],
            },
          ],
        },
      ],
    ]);
  });

  it("lets the user cancel without answering", async () => {
    const wrapper = mountCard();
    await wrapper.get("button[data-variant='ghost']").trigger("click");

    expect(wrapper.emitted("respond")).toEqual([
      [{ answers: [], cancelled: true }],
    ]);
  });
});
