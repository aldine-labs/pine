import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_LOCALE_STORAGE_KEY, createAppI18n } from "@/app/i18n";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { PineModelCatalog } from "@/shared/models";
import {
  SIDEBAR_VIBRANCY_STORAGE_KEY,
  THEME_PREFERENCE_STORAGE_KEY,
  useAppearanceStore,
} from "@/stores/appearance";
import { useModelsStore } from "@/stores/models";
import PinePreferencesDialog from "../PinePreferencesDialog.vue";

const passthroughStub = { template: "<div><slot /></div>" };
const modelPickerStub = {
  props: ["open", "purpose"],
  emits: ["update:open"],
  template:
    '<div data-model-picker :data-open="open" :data-purpose="purpose" />',
};
const userProfileStub = {
  props: ["open"],
  emits: ["update:open"],
  template: '<div data-user-profile-dialog :data-open="open" />',
};
const setSidebarVibrancy = vi.fn().mockResolvedValue({ applied: true });
const getTinyFishCredentialStatus = vi
  .fn()
  .mockResolvedValue({ configured: false });
const setTinyFishApiKey = vi.fn().mockResolvedValue({ configured: true });
const getUserProfile = vi.fn();
const setUserProfile = vi.fn().mockResolvedValue({ updated: true });
const getContextCompactionStrategy = vi.fn().mockResolvedValue("recommended");
const setContextCompactionStrategy = vi.fn().mockResolvedValue({
  updated: true,
});

function installPineApi(platform: string | undefined): void {
  const pineWindow = window as unknown as {
    pine?: {
      platform: string;
      setSidebarVibrancy: typeof setSidebarVibrancy;
      getTinyFishCredentialStatus: typeof getTinyFishCredentialStatus;
      setTinyFishApiKey: typeof setTinyFishApiKey;
      getUserProfile: typeof getUserProfile;
      setUserProfile: typeof setUserProfile;
      getContextCompactionStrategy: typeof getContextCompactionStrategy;
      setContextCompactionStrategy: typeof setContextCompactionStrategy;
    };
  };
  if (platform === undefined) {
    delete pineWindow.pine;
    return;
  }
  pineWindow.pine = {
    platform,
    setSidebarVibrancy,
    getTinyFishCredentialStatus,
    setTinyFishApiKey,
    getUserProfile,
    setUserProfile,
    getContextCompactionStrategy,
    setContextCompactionStrategy,
  };
}

function mountDialog() {
  const pinia = createPinia();
  const i18n = createAppI18n("zh-CN");
  setActivePinia(pinia);

  const wrapper = mount(PinePreferencesDialog, {
    global: {
      plugins: [pinia, i18n],
      stubs: {
        Dialog: passthroughStub,
        DialogContent: passthroughStub,
        DialogHeader: passthroughStub,
        DialogTitle: passthroughStub,
        DialogTrigger: passthroughStub,
        ModelPickerDialog: modelPickerStub,
        UserProfileDialog: userProfileStub,
      },
    },
  });

  return { i18n, pinia, wrapper };
}

describe("PinePreferencesDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.remove("sidebar-vibrancy");
    document.documentElement.lang = "zh-CN";
    setSidebarVibrancy.mockClear();
    getTinyFishCredentialStatus.mockClear();
    setTinyFishApiKey.mockClear();
    getUserProfile.mockReset();
    getUserProfile.mockResolvedValue({
      communicationStyle: "calm-professional",
      customInstructions: "",
      nickname: "",
      personalDetails: "",
      technicalBackground: "enthusiast",
    });
    setUserProfile.mockClear();
    getContextCompactionStrategy.mockClear();
    setContextCompactionStrategy.mockClear();
    getTinyFishCredentialStatus.mockResolvedValue({ configured: false });
    setTinyFishApiKey.mockResolvedValue({ configured: true });
    installPineApi(undefined);
  });

  afterEach(() => {
    installPineApi(undefined);
  });

  it("shows the selected utility model name", async () => {
    const { pinia, wrapper } = mountDialog();
    const catalog: PineModelCatalog = {
      models: [
        {
          api: "test",
          contextWindow: 128_000,
          id: "glm-4.5-air",
          input: ["text"],
          maxTokens: 8_192,
          name: "GLM 4.5 Air",
          providerId: "zai",
          providerName: "Z.AI",
          reasoning: false,
          supportedThinkingLevels: ["off"],
        },
      ],
      providers: [],
      utilitySelection: { modelId: "glm-4.5-air", providerId: "zai" },
    };

    useModelsStore(pinia).catalog = catalog;
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain("GLM 4.5 Air");
    expect(wrapper.text()).not.toContain("未选择任何模型");
  });

  it("saves a TinyFish key and changes the action label", async () => {
    installPineApi("linux");
    const { wrapper } = mountDialog();

    await wrapper
      .get('[data-testid="pine-tinyfish-credential-button"]')
      .trigger("click");
    await wrapper.get('input[type="password"]').setValue("tinyfish-secret");
    await wrapper.get("form").trigger("submit");

    await vi.waitFor(() =>
      expect(setTinyFishApiKey).toHaveBeenCalledWith({
        apiKey: "tinyfish-secret",
      }),
    );
    expect(wrapper.text()).toContain("更改密钥");
  });

  it("opens the shared model picker in utility mode", async () => {
    const { wrapper } = mountDialog();
    const picker = wrapper.get("[data-model-picker]");
    const selectButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "选择模型");

    expect(picker.attributes("data-purpose")).toBe("utility");
    expect(picker.attributes("data-open")).toBe("false");

    await selectButton?.trigger("click");

    expect(picker.attributes("data-open")).toBe("true");
  });

  it("opens the user profile editor", async () => {
    const { wrapper } = mountDialog();
    const editor = wrapper.get("[data-user-profile-dialog]");

    expect(editor.attributes("data-open")).toBe("false");

    await wrapper
      .get('[data-testid="pine-user-profile-edit-button"]')
      .trigger("click");

    expect(editor.attributes("data-open")).toBe("true");
  });

  it("applies and persists language and theme selections", async () => {
    const { i18n, pinia, wrapper } = mountDialog();
    const groups = wrapper.findAllComponents(ToggleGroup);

    groups[0]?.vm.$emit("update:modelValue", "en-US");
    groups[1]?.vm.$emit("update:modelValue", "dark");
    await wrapper.vm.$nextTick();

    expect(i18n.global.locale.value).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
    expect(window.localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("en-US");
    expect(useAppearanceStore(pinia).themePreference).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY)).toBe(
      "dark",
    );
  });

  it("loads the recommended compaction strategy and persists changes", async () => {
    installPineApi("linux");
    const { wrapper } = mountDialog();
    await vi.waitFor(() =>
      expect(getContextCompactionStrategy).toHaveBeenCalled(),
    );
    const group = wrapper
      .findAllComponents(ToggleGroup)
      .find(
        (candidate) =>
          candidate.attributes("aria-labelledby") ===
          "pine-context-compaction-strategy-setting",
      );

    expect(group?.props("modelValue")).toBe("recommended");
    group?.vm.$emit("update:modelValue", "passive");

    await vi.waitFor(() =>
      expect(setContextCompactionStrategy).toHaveBeenCalledWith({
        strategy: "passive",
      }),
    );
  });

  it("shows the compaction description from a focusable help badge", async () => {
    const { wrapper } = mountDialog();
    const helpBadge = wrapper.get('button[aria-label="关于上下文压缩策略"]');
    const description =
      "推荐设置会在上下文达到 80% 时压缩，并将触发上限限制在 400K Token。";

    expect(wrapper.getComponent(Badge).props("variant")).toBe("secondary");
    expect(helpBadge.text()).toBe("");
    expect(helpBadge.classes()).toEqual(
      expect.arrayContaining(["size-5", "translate-y-px", "p-0"]),
    );
    expect(helpBadge.find("svg").attributes("aria-hidden")).toBe("true");
    expect(
      wrapper
        .findAll('[data-slot="field-description"]')
        .some((fieldDescription) => fieldDescription.text() === description),
    ).toBe(false);

    await helpBadge.trigger("focus");
    await vi.waitFor(() => {
      expect(
        document.querySelector('[data-slot="tooltip-content"]')?.textContent,
      ).toContain(description);
    });
  });

  it("toggles the macOS sidebar vibrancy effect", async () => {
    installPineApi("darwin");
    const { wrapper } = mountDialog();
    const toggle = wrapper.get('[data-testid="pine-sidebar-vibrancy-toggle"]');

    expect(wrapper.text()).toContain("\u4fa7\u680f\u6a21\u7cca\u6548\u679c");

    await toggle.trigger("click");

    expect(
      document.documentElement.classList.contains("sidebar-vibrancy"),
    ).toBe(true);
    expect(window.localStorage.getItem(SIDEBAR_VIBRANCY_STORAGE_KEY)).toBe(
      "true",
    );
    expect(setSidebarVibrancy).toHaveBeenCalledWith({ enabled: true });

    await toggle.trigger("click");

    expect(
      document.documentElement.classList.contains("sidebar-vibrancy"),
    ).toBe(false);
    expect(window.localStorage.getItem(SIDEBAR_VIBRANCY_STORAGE_KEY)).toBe(
      "false",
    );
    expect(setSidebarVibrancy).toHaveBeenCalledWith({ enabled: false });
  });
});
