import { describe, expect, it } from "vitest";
import {
  buildAskUserQuestionToolResult,
  normalizeAskUserQuestionParams,
  resolveAskUserQuestionSubmission,
  validateAskUserQuestion,
  type AskUserQuestionParams,
} from "@pine/rpiv-ask-user-question";

const params: AskUserQuestionParams = {
  questions: [
    {
      header: "Approach",
      question: "How should Pine implement this?",
      options: [
        {
          label: "Small patch",
          description: "Keep the change narrow.",
          preview: "`minimal`",
        },
        {
          label: "Full adapter",
          description: "Create a reusable boundary.",
        },
      ],
    },
  ],
};

describe("ask_user_question contract", () => {
  it("normalizes model text before validating reserved labels", () => {
    const normalized = normalizeAskUserQuestionParams({
      questions: [
        {
          ...params.questions[0],
          options: [
            { label: "Oth\rer", description: "Reserved after cleanup." },
            params.questions[0].options[1],
          ],
        },
      ],
    });

    expect(validateAskUserQuestion(normalized)).toEqual({
      ok: false,
      error: "reserved_label",
      message: "Error: Option label is reserved (Other, Type something., Next)",
    });
  });

  it("returns an upstream-compatible answer envelope", () => {
    const result = resolveAskUserQuestionSubmission(params, {
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          selectedOptionIndexes: [0],
        },
      ],
    });

    expect(result.answers[0]).toEqual(
      expect.objectContaining({
        kind: "option",
        answer: "Small patch",
        preview: "`minimal`",
      }),
    );
    expect(buildAskUserQuestionToolResult(result, params).content[0].text).toBe(
      'User has answered your questions: "How should Pine implement this?"="Small patch". selected preview: `minimal`. You can now continue with the user\'s answers in mind.',
    );
  });

  it("keeps authored and custom values in multi-select answers", () => {
    const multiParams: AskUserQuestionParams = {
      questions: [{ ...params.questions[0], multiSelect: true }],
    };
    const result = resolveAskUserQuestionSubmission(multiParams, {
      cancelled: false,
      answers: [
        {
          questionIndex: 0,
          selectedOptionIndexes: [1],
          customAnswer: "Add tests",
        },
      ],
    });

    expect(result.answers[0]).toEqual(
      expect.objectContaining({
        kind: "multi",
        selected: ["Full adapter", "Add tests"],
      }),
    );
  });
});
