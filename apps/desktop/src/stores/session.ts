import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, shallowRef } from "vue";
import {
  isSandboxDeniedPayload,
  type PineAgentEvent,
  type PineAssistantMessageUpdate,
  type PineApprovalAction,
  type PineApprovalMode,
  type PineApprovalTrigger,
  type PineJsonValue,
} from "@/shared/agent";
import type {
  PineContentBlock,
  PineCompactionStatus,
  PineContextUsage,
  PineSessionSummary,
  PineTextMessage,
  PineToolCall,
  SessionSearchResult,
} from "@/shared/sessions";
import { attachmentMessagePreview } from "@/shared/attachments";
import { parseMessageBlocks } from "@/shared/sessions";
import { isAppLocale } from "@/app/i18n";
import { useModelsStore } from "@/stores/models";
import type {
  AskUserQuestionParams,
  AskUserQuestionSubmission,
} from "@pine/rpiv-ask-user-question";

function currentAppLocale(): "en-US" | "zh-CN" {
  const locale = document.documentElement.lang;
  return isAppLocale(locale) ? locale : "en-US";
}

export interface PineTranscriptMessage extends PineTextMessage {
  status: "complete" | "streaming";
  thinkingStatus?: "complete" | "streaming";
  thinkingStartedAt?: number;
}

/** A tool call awaiting the user's approve/reject/guide decision. */
export interface PinePendingApproval {
  requestId: string;
  toolCallId: string;
  toolName: string;
  trigger: PineApprovalTrigger;
  subject?: string;
  /** The tool call's imperative summary, shown above the raw arguments. */
  description?: string;
  evidence?: string;
}

export interface PinePendingQuestionnaire {
  requestId: string;
  toolCallId: string;
  questionnaire: AskUserQuestionParams;
}

function messageRole(value: PineJsonValue): "assistant" | "user" | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value.role === "assistant" || value.role === "user"
    ? value.role
    : null;
}

function blocksHasThinking(blocks: readonly PineContentBlock[]): boolean {
  return blocks.some((block) => block.type === "thinking");
}

function toTranscriptMessages(
  source: readonly PineTextMessage[],
): PineTranscriptMessage[] {
  return source.map((message) => ({
    ...message,
    status: "complete" as const,
    ...(blocksHasThinking(message.blocks)
      ? { thinkingStatus: "complete" as const }
      : {}),
  }));
}

function mergeToolCallBlocks(
  blocks: PineContentBlock[],
  toolCallId: string,
  patch: Partial<PineToolCall>,
): PineContentBlock[] {
  return blocks.map((block) => {
    if (block.type !== "toolCall" || block.toolCall.id !== toolCallId) {
      return block;
    }
    return { ...block, toolCall: { ...block.toolCall, ...patch } };
  });
}

function mergeBlockStatuses(
  blocks: PineContentBlock[],
  previous: readonly PineContentBlock[] | undefined,
): PineContentBlock[] {
  if (!previous || previous.length === 0) return blocks;
  const previousToolCalls = new Map(
    previous.flatMap((block) =>
      block.type === "toolCall" ? [[block.toolCall.id, block.toolCall]] : [],
    ),
  );
  return blocks.map((block) => {
    if (block.type !== "toolCall") return block;
    const prior = previousToolCalls.get(block.toolCall.id);
    if (!prior) return block;
    // Execution runtime fields (status/startedAt/durationMs/output) come from
    // the prior snapshot, but streaming input grows on every update — a stale
    // snapshot (e.g. an empty arguments object from toolcall_start) must not
    // shadow the freshly parsed progressive arguments.
    const toolCall = {
      ...prior,
      id: block.toolCall.id,
      name: block.toolCall.name,
    };
    if (block.toolCall.input !== undefined) {
      toolCall.input = block.toolCall.input;
    }
    return { ...block, toolCall };
  });
}

function messageCreatedAt(value: PineJsonValue): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return new Date().toISOString();
  }
  return typeof value.timestamp === "number"
    ? new Date(value.timestamp).toISOString()
    : new Date().toISOString();
}

function applyAssistantMessageUpdates(
  previous: readonly PineContentBlock[],
  updates: readonly PineAssistantMessageUpdate[],
): PineContentBlock[] {
  const blocks = [...previous];
  for (const update of updates) {
    const current = blocks[update.contentIndex];
    switch (update.type) {
      case "text-start":
        blocks[update.contentIndex] = { type: "text", text: update.text };
        break;
      case "text-delta":
        blocks[update.contentIndex] = {
          type: "text",
          text:
            current?.type === "text"
              ? current.text + update.delta
              : update.delta,
        };
        break;
      case "text-end":
        blocks[update.contentIndex] = { type: "text", text: update.text };
        break;
      case "thinking-start":
        blocks[update.contentIndex] = {
          type: "thinking",
          thinking: update.thinking,
        };
        break;
      case "thinking-delta":
        blocks[update.contentIndex] = {
          type: "thinking",
          thinking:
            current?.type === "thinking"
              ? current.thinking + update.delta
              : update.delta,
        };
        break;
      case "thinking-end":
        blocks[update.contentIndex] = {
          type: "thinking",
          thinking: update.thinking,
        };
        break;
      case "tool-call-start":
        blocks[update.contentIndex] = {
          type: "toolCall",
          toolCall: {
            id: update.id,
            name: update.name,
            status: "pending",
            ...(update.input === undefined ? {} : { input: update.input }),
          },
        };
        break;
      case "tool-call-delta":
        if (current?.type === "toolCall" && update.input !== undefined) {
          blocks[update.contentIndex] = {
            ...current,
            toolCall: { ...current.toolCall, input: update.input },
          };
        }
        break;
      case "tool-call-end":
        blocks[update.contentIndex] = {
          type: "toolCall",
          toolCall: {
            ...(current?.type === "toolCall" ? current.toolCall : {}),
            id: update.id,
            name: update.name,
            status:
              current?.type === "toolCall"
                ? current.toolCall.status
                : "pending",
            ...(update.input === undefined ? {} : { input: update.input }),
          },
        };
        break;
    }
  }
  return blocks;
}

function compactionMessage(
  compactionId: string,
  status: PineCompactionStatus,
): PineTranscriptMessage {
  return {
    createdAt: new Date().toISOString(),
    id: `compaction-${compactionId}`,
    role: "assistant",
    status: status === "running" ? "streaming" : "complete",
    blocks: [
      {
        type: "compaction",
        compaction: { id: compactionId, status },
      },
    ],
  };
}

export const useSessionStore = defineStore("session", () => {
  const modelsStore = useModelsStore();
  const activeSession = shallowRef<PineSessionSummary | null>(null);
  const messages = ref<PineTranscriptMessage[]>([]);
  const outlineMessages = ref<PineTranscriptMessage[]>([]);
  const recentSessions = shallowRef<SessionSearchResult[]>([]);
  const searchResults = shallowRef<SessionSearchResult[]>([]);
  const isLoadingRecent = ref(false);
  const isSearching = ref(false);
  const isLoadingMessages = ref(false);
  const isRunning = ref(false);
  const contextUsage = ref<PineContextUsage | null>(null);
  const pendingApprovals = ref<PinePendingApproval[]>([]);
  const pendingQuestionnaires = ref<PinePendingQuestionnaire[]>([]);
  const steeringMessages = ref<string[]>([]);
  /** Tool calls currently held by the auto-reviewer (auto-approve). */
  const reviewingToolCallIds = ref<ReadonlySet<string>>(new Set());
  const hasEarlierMessages = ref(false);
  const nextBefore = ref<string | undefined>();
  const messageIndexes = new Map<string, number>();
  const toolCallMessageIndexes = new Map<string, number>();

  function messageIndexFor(messageId: string): number {
    const cached = messageIndexes.get(messageId);
    if (cached !== undefined && messages.value[cached]?.id === messageId) {
      return cached;
    }
    const index = messages.value.findIndex(
      (message) => message.id === messageId,
    );
    if (index >= 0) messageIndexes.set(messageId, index);
    else messageIndexes.delete(messageId);
    return index;
  }

  function toolCallMessageIndexFor(toolCallId: string): number {
    const cached = toolCallMessageIndexes.get(toolCallId);
    if (
      cached !== undefined &&
      messages.value[cached]?.blocks.some(
        (block) =>
          block.type === "toolCall" && block.toolCall.id === toolCallId,
      )
    ) {
      return cached;
    }
    const index = messages.value.findIndex((message) =>
      message.blocks.some(
        (block) =>
          block.type === "toolCall" && block.toolCall.id === toolCallId,
      ),
    );
    if (index >= 0) toolCallMessageIndexes.set(toolCallId, index);
    else toolCallMessageIndexes.delete(toolCallId);
    return index;
  }

  function rememberMessageIndex(
    message: PineTranscriptMessage,
    index: number,
  ): void {
    messageIndexes.set(message.id, index);
    for (const block of message.blocks) {
      if (block.type === "toolCall") {
        toolCallMessageIndexes.set(block.toolCall.id, index);
      }
    }
  }

  function clearMessageIndexes(): void {
    messageIndexes.clear();
    toolCallMessageIndexes.clear();
  }

  // Each open session keeps its own transcript slice so switching tabs never
  // clobbers a sibling's loaded messages or forces a re-fetch. `messages` (
  // active projection) points at the focused session's array; keeping the same
  // array reference across restores lets KeepAlive'd views diff minimally.
  interface CachedSession {
    summary: PineSessionSummary | null;
    messages: PineTranscriptMessage[];
    outlineMessages: PineTranscriptMessage[];
    contextUsage: PineContextUsage | null;
    steeringMessages: string[];
    hasEarlierMessages: boolean;
    nextBefore?: string;
  }
  const sessionCache = new Map<string, CachedSession>();
  const staleSessions = new Set<string>();
  const sessionRunStates = new Map<string, boolean>();

  /** Snapshot the active transcript projection into the session cache. */
  function syncSessionCache(sessionId: string): void {
    if (!sessionId) return;
    sessionCache.set(sessionId, {
      summary: activeSession.value,
      messages: messages.value,
      outlineMessages: outlineMessages.value,
      contextUsage: contextUsage.value,
      steeringMessages: steeringMessages.value,
      hasEarlierMessages: hasEarlierMessages.value,
      nextBefore: nextBefore.value,
    });
  }

  /** Drop a session's cached transcript (e.g. when it is closed/deleted). */
  function dropSessionCache(sessionId: string): void {
    sessionCache.delete(sessionId);
    staleSessions.delete(sessionId);
    sessionRunStates.delete(sessionId);
  }

  /** Merge transient runtime or approval details into one visible tool call. */
  function patchToolCall(
    toolCallId: string,
    patch: Partial<PineToolCall>,
  ): void {
    const messageIndex = toolCallMessageIndexFor(toolCallId);
    if (messageIndex < 0) return;
    const message = messages.value[messageIndex];
    messages.value[messageIndex] = {
      ...message,
      blocks: mergeToolCallBlocks(message.blocks, toolCallId, patch),
    };
  }
  let currentSessionId: string | null = null;
  let stopAgentEvents: (() => void) | null = null;
  let searchSequence = 0;
  let recentSequence = 0;
  let activationSequence = 0;
  let isStartingPrompt = false;

  function mergeSessionSummary(
    session: PineSessionSummary,
    previous?: PineSessionSummary,
  ): PineSessionSummary {
    return {
      ...previous,
      ...session,
      ...(session.name || previous?.name
        ? { name: session.name || previous?.name }
        : {}),
      ...(session.preview || previous?.preview
        ? { preview: session.preview || previous?.preview }
        : {}),
    };
  }

  function upsertRecentSession(
    session: PineSessionSummary,
  ): SessionSearchResult {
    recentSequence += 1;
    isLoadingRecent.value = false;
    const previous = recentSessions.value.find(
      (candidate) => candidate.id === session.id,
    );
    const nextSession = mergeSessionSummary(session, previous);
    recentSessions.value = [
      nextSession,
      ...recentSessions.value.filter(
        (candidate) => candidate.id !== session.id,
      ),
    ].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() -
        new Date(left.updatedAt).getTime(),
    );
    return nextSession;
  }

  async function loadRecent(): Promise<SessionSearchResult[]> {
    const sequence = ++recentSequence;
    isLoadingRecent.value = true;

    try {
      const result = await window.pine.searchSessions({ query: "" });
      if (sequence === recentSequence) recentSessions.value = result.sessions;
      return result.sessions;
    } finally {
      if (sequence === recentSequence) isLoadingRecent.value = false;
    }
  }

  async function search(query: string): Promise<SessionSearchResult[]> {
    const sequence = ++searchSequence;
    isSearching.value = true;

    try {
      const sessions = query.trim()
        ? (await window.pine.searchSessions({ query })).sessions
        : await loadRecent();
      if (sequence === searchSequence) searchResults.value = sessions;
      return sessions;
    } finally {
      if (sequence === searchSequence) isSearching.value = false;
    }
  }

  async function resume(sessionId: string): Promise<PineSessionSummary> {
    const sequence = ++activationSequence;
    currentSessionId = sessionId;
    isStartingPrompt = false;

    // Restore the cached transcript without re-fetching so switching back to a
    // tab keeps its messages (same array reference) and never reloads.
    const cached = sessionCache.get(sessionId);
    if (cached && cached.summary) {
      activeSession.value = cached.summary;
      messages.value = cached.messages;
      outlineMessages.value = cached.outlineMessages;
      clearMessageIndexes();
      contextUsage.value = cached.contextUsage;
      steeringMessages.value = cached.steeringMessages;
      isLoadingMessages.value = false;
      hasEarlierMessages.value = cached.hasEarlierMessages;
      nextBefore.value = cached.nextBefore;
      isRunning.value = sessionRunStates.get(sessionId) ?? false;
      if (staleSessions.has(sessionId)) {
        staleSessions.delete(sessionId);
        await loadInitialMessages(sessionId);
      }
      return cached.summary;
    }

    activeSession.value = null;
    messages.value = [];
    outlineMessages.value = [];
    clearMessageIndexes();
    hasEarlierMessages.value = false;
    nextBefore.value = undefined;
    contextUsage.value = null;
    steeringMessages.value = [];
    isLoadingMessages.value = true;

    try {
      const result = await window.pine.resumeSession({ sessionId });
      const session = upsertRecentSession(result.session);
      if (sequence !== activationSequence) return result.session;

      modelsStore.setSessionSelection(session.id, session.modelSelection);
      activeSession.value = session;
      currentSessionId = session.id;
      isRunning.value = sessionRunStates.get(session.id) ?? false;
      contextUsage.value = result.contextUsage ?? null;
      await loadInitialMessages(session.id);
      return session;
    } catch (error) {
      if (sequence === activationSequence) {
        currentSessionId = null;
        isLoadingMessages.value = false;
      }
      throw error;
    }
  }

  async function loadInitialMessages(sessionId: string): Promise<void> {
    isLoadingMessages.value = true;
    try {
      const result = await window.pine.loadSessionMessages({
        includeOutline: true,
        sessionId,
        limit: 50,
      });
      if (currentSessionId !== sessionId) return;
      messages.value = toTranscriptMessages(result.messages);
      outlineMessages.value = toTranscriptMessages(
        result.outline ?? result.messages,
      );
      clearMessageIndexes();
      hasEarlierMessages.value = result.hasMore;
      nextBefore.value = result.nextBefore;
      syncSessionCache(sessionId);
    } finally {
      if (currentSessionId === sessionId) isLoadingMessages.value = false;
    }
  }

  async function loadEarlierMessages(): Promise<void> {
    const sessionId = currentSessionId;
    if (
      !sessionId ||
      !hasEarlierMessages.value ||
      !nextBefore.value ||
      isLoadingMessages.value
    ) {
      return;
    }

    isLoadingMessages.value = true;
    try {
      const result = await window.pine.loadSessionMessages({
        before: nextBefore.value,
        sessionId,
        limit: 50,
      });
      if (currentSessionId !== sessionId) return;
      const earlierMessages = toTranscriptMessages(result.messages);
      messages.value = [...earlierMessages, ...messages.value];
      const existingOutlineIds = new Set(
        outlineMessages.value.map((message) => message.id),
      );
      outlineMessages.value = [
        ...earlierMessages.filter(
          (message) => !existingOutlineIds.has(message.id),
        ),
        ...outlineMessages.value,
      ];
      clearMessageIndexes();
      hasEarlierMessages.value = result.hasMore;
      nextBefore.value = result.nextBefore;
      syncSessionCache(sessionId);
    } finally {
      if (currentSessionId === sessionId) isLoadingMessages.value = false;
    }
  }

  async function prompt(
    message: string,
    sessionId?: string,
    approvalMode?: PineApprovalMode,
    streamingBehavior?: "follow-up" | "steer",
  ): Promise<PineSessionSummary> {
    const sequence = ++activationSequence;
    currentSessionId = sessionId ?? null;
    isStartingPrompt = sessionId === undefined;
    isRunning.value = true;
    try {
      const result = await window.pine.promptSession({
        locale: currentAppLocale(),
        message,
        target: sessionId ? { kind: "session", sessionId } : { kind: "new" },
        ...(approvalMode ? { approvalMode } : {}),
        ...(streamingBehavior ? { streamingBehavior } : {}),
      });
      const session = {
        ...result.session,
        preview: result.session.preview || attachmentMessagePreview(message),
      };
      const nextSession = upsertRecentSession(session);
      if (sequence !== activationSequence) return nextSession;

      modelsStore.setSessionSelection(
        nextSession.id,
        nextSession.modelSelection,
      );
      isStartingPrompt = false;
      activeSession.value = nextSession;
      currentSessionId = nextSession.id;
      syncSessionCache(nextSession.id);
      return nextSession;
    } catch (error) {
      if (sequence === activationSequence) {
        isStartingPrompt = false;
        if (!streamingBehavior) isRunning.value = false;
      }
      throw error;
    }
  }

  async function steer(
    message: string,
    approvalMode?: PineApprovalMode,
  ): Promise<void> {
    const sessionId = currentSessionId;
    if (!sessionId) {
      throw new Error("The running session is not ready for steering yet.");
    }
    await window.pine.promptSession({
      locale: currentAppLocale(),
      message,
      target: { kind: "session", sessionId },
      approvalMode,
      streamingBehavior: "steer",
    });
  }

  async function abort(): Promise<void> {
    await window.pine.abortSession();
  }

  async function compactContext(): Promise<boolean> {
    if (!currentSessionId) return false;
    const result = await window.pine.compactSession();
    return result.compacted;
  }

  async function dequeueSteering(message: string): Promise<string | undefined> {
    const result = await window.pine.dequeueSteering({ message });
    return result.removed ? result.message : undefined;
  }

  async function setApprovalMode(
    approvalMode: PineApprovalMode,
  ): Promise<void> {
    await window.pine.setApprovalMode({ approvalMode });
  }

  /** Answer the oldest pending approval (approve / reject / guide). */
  async function respondApproval(
    action: PineApprovalAction,
    guidance?: string,
  ): Promise<void> {
    const pending = pendingApprovals.value[0];
    if (!pending) return;
    pendingApprovals.value = pendingApprovals.value.slice(1);
    try {
      await window.pine.respondApproval({
        requestId: pending.requestId,
        action,
        guidance,
      });
    } catch {
      // The request may already be gone (session closed, run aborted); the
      // optimistic removal above matches that outcome.
    }
  }

  async function respondQuestionnaire(
    submission: AskUserQuestionSubmission,
  ): Promise<void> {
    const pending = pendingQuestionnaires.value[0];
    if (!pending) return;
    pendingQuestionnaires.value = pendingQuestionnaires.value.slice(1);
    try {
      await window.pine.respondQuestionnaire({
        requestId: pending.requestId,
        submission,
      });
    } catch {
      // The run may have been aborted while the user submitted the card.
    }
  }

  async function deleteSession(sessionId: string): Promise<boolean> {
    const { deleted } = await window.pine.deleteSession({ sessionId });
    if (!deleted) return false;

    recentSequence += 1;
    isLoadingRecent.value = false;
    recentSessions.value = recentSessions.value.filter(
      (session) => session.id !== sessionId,
    );
    searchResults.value = searchResults.value.filter(
      (session) => session.id !== sessionId,
    );
    dropSessionCache(sessionId);
    modelsStore.setSessionSelection(sessionId, undefined);
    if (currentSessionId === sessionId) startDraft();
    return true;
  }

  async function renameSession(
    sessionId: string,
    name: string,
  ): Promise<PineSessionSummary> {
    const result = await window.pine.renameSession({ sessionId, name });
    const previous =
      recentSessions.value.find((session) => session.id === sessionId) ??
      searchResults.value.find((session) => session.id === sessionId) ??
      (activeSession.value?.id === sessionId
        ? activeSession.value
        : undefined) ??
      sessionCache.get(sessionId)?.summary ??
      undefined;
    const session = mergeSessionSummary(result.session, previous ?? undefined);

    recentSequence += 1;
    searchSequence += 1;
    recentSessions.value = recentSessions.value
      .map((candidate) => (candidate.id === sessionId ? session : candidate))
      .sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      );
    searchResults.value = searchResults.value.map((candidate) =>
      candidate.id === sessionId ? { ...candidate, ...session } : candidate,
    );
    if (activeSession.value?.id === sessionId) activeSession.value = session;

    const cached = sessionCache.get(sessionId);
    if (cached) sessionCache.set(sessionId, { ...cached, summary: session });
    return session;
  }

  function handleAgentEvent(event: PineAgentEvent): void {
    if (event.type === "run-state") {
      sessionRunStates.set(
        event.sessionId,
        event.state === "running" || event.state === "aborting",
      );
      if (
        event.state === "running" &&
        isStartingPrompt &&
        currentSessionId === null
      ) {
        currentSessionId = event.sessionId;
      }
      if (currentSessionId !== event.sessionId) {
        staleSessions.add(event.sessionId);
        return;
      }
      isRunning.value = event.state === "running" || event.state === "aborting";
      // Aborted turns resolve pending approvals without a decided event.
      if (event.state === "idle") {
        pendingApprovals.value = [];
        pendingQuestionnaires.value = [];
        reviewingToolCallIds.value = new Set();
        steeringMessages.value = [];
      }
      return;
    }
    if (currentSessionId !== event.sessionId) {
      staleSessions.add(event.sessionId);
      if (event.type === "session-updated") {
        const cached = sessionCache.get(event.sessionId);
        const summary = upsertRecentSession(
          mergeSessionSummary(event.summary, cached?.summary ?? undefined),
        );
        if (cached) cached.summary = summary;
      }
      return;
    }
    if (event.type === "steering-queue") {
      if (currentSessionId !== event.sessionId) return;
      steeringMessages.value = [...event.messages];
      syncSessionCache(event.sessionId);
      return;
    }
    if (event.type === "session-error") {
      if (currentSessionId !== event.sessionId) return;
      messages.value.push({
        createdAt: new Date().toISOString(),
        id: `error-${event.errorId}`,
        role: "assistant",
        status: "complete",
        blocks: [{ type: "error", error: { message: event.message } }],
      });
      return;
    }
    if (event.type === "tool-review") {
      if (currentSessionId !== event.sessionId) return;
      reviewingToolCallIds.value = new Set([
        ...reviewingToolCallIds.value,
        event.toolCallId,
      ]);
      patchToolCall(event.toolCallId, {
        approval: { state: "reviewing" },
      });
      return;
    }
    if (event.type === "approval-request") {
      if (currentSessionId !== event.sessionId) return;
      const input = event.input as
        { subject?: unknown; description?: unknown } | undefined;
      pendingApprovals.value = [
        ...pendingApprovals.value,
        {
          requestId: event.requestId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          trigger: event.trigger,
          subject:
            typeof input?.subject === "string" ? input.subject : undefined,
          description:
            typeof input?.description === "string"
              ? input.description
              : undefined,
          evidence: event.evidence,
        },
      ];
      patchToolCall(event.toolCallId, {
        approval: { state: "awaiting-user" },
      });
      return;
    }
    if (event.type === "approval-decided") {
      if (currentSessionId !== event.sessionId) return;
      pendingApprovals.value = pendingApprovals.value.filter(
        (approval) => approval.requestId !== event.requestId,
      );
      const remaining = new Set(reviewingToolCallIds.value);
      remaining.delete(event.toolCallId);
      reviewingToolCallIds.value = remaining;
      patchToolCall(event.toolCallId, {
        approval: {
          state: event.verdict === "approved" ? "approved" : "denied",
          decidedBy: event.decidedBy,
          ...(event.reason ? { reason: event.reason } : {}),
        },
      });
      return;
    }
    if (event.type === "questionnaire-request") {
      if (currentSessionId !== event.sessionId) return;
      pendingQuestionnaires.value = [
        ...pendingQuestionnaires.value,
        {
          requestId: event.requestId,
          toolCallId: event.toolCallId,
          questionnaire: event.questionnaire,
        },
      ];
      return;
    }
    if (event.type === "questionnaire-decided") {
      if (currentSessionId !== event.sessionId) return;
      pendingQuestionnaires.value = pendingQuestionnaires.value.filter(
        (questionnaire) => questionnaire.requestId !== event.requestId,
      );
      return;
    }
    if (event.type === "session-updated") {
      if (currentSessionId !== event.sessionId) return;
      const previous =
        activeSession.value?.id === event.sessionId
          ? activeSession.value
          : recentSessions.value.find(
              (session) => session.id === event.sessionId,
            );
      const summary = mergeSessionSummary(event.summary, previous);
      modelsStore.setSessionSelection(event.sessionId, summary.modelSelection);
      activeSession.value = summary;
      upsertRecentSession(summary);
      return;
    }
    if (event.type === "context-usage") {
      if (currentSessionId !== event.sessionId) return;
      const usage: PineContextUsage = {
        tokens: event.tokens,
        contextWindow: event.contextWindow,
        percent: event.percent,
        cost: event.cost,
        cacheHitRate: event.cacheHitRate,
      };
      contextUsage.value = usage;
      const cached = sessionCache.get(event.sessionId);
      if (cached) cached.contextUsage = usage;
      return;
    }
    if (
      (event.type === "compaction-start" || event.type === "compaction-end") &&
      currentSessionId === event.sessionId
    ) {
      const status: PineCompactionStatus =
        event.type === "compaction-start" ? "running" : event.status;
      const messageIndex = messageIndexFor(`compaction-${event.compactionId}`);
      const previous =
        messageIndex >= 0 ? messages.value[messageIndex] : undefined;
      const nextMessage = previous
        ? {
            ...previous,
            status:
              status === "running"
                ? ("streaming" as const)
                : ("complete" as const),
            blocks: [
              {
                type: "compaction" as const,
                compaction: { id: event.compactionId, status },
              },
            ],
          }
        : compactionMessage(event.compactionId, status);
      if (messageIndex < 0) {
        messages.value.push(nextMessage);
        rememberMessageIndex(nextMessage, messages.value.length - 1);
      } else {
        messages.value[messageIndex] = nextMessage;
        rememberMessageIndex(nextMessage, messageIndex);
      }
      return;
    }
    if (
      (event.type === "tool-start" ||
        event.type === "tool-update" ||
        event.type === "tool-end") &&
      currentSessionId === event.sessionId
    ) {
      const now = Date.now();
      let messageIndex = toolCallMessageIndexFor(event.toolCallId);
      if (messageIndex < 0) {
        messages.value.push({
          createdAt: new Date(now).toISOString(),
          id: `tool-${event.toolCallId}`,
          role: "assistant",
          status: "complete",
          blocks: [
            {
              type: "toolCall",
              toolCall: {
                id: event.toolCallId,
                name: event.toolName,
                status: "pending",
              },
            },
          ],
        });
        messageIndex = messages.value.length - 1;
        rememberMessageIndex(messages.value[messageIndex], messageIndex);
      }

      const message = messages.value[messageIndex];
      const existing = message.blocks.find(
        (block) =>
          block.type === "toolCall" && block.toolCall.id === event.toolCallId,
      );
      const existingToolCall =
        existing?.type === "toolCall" ? existing.toolCall : undefined;
      const startedAt =
        existingToolCall?.startedAt ??
        (event.type === "tool-start" ? new Date(now).toISOString() : undefined);
      const patch: Partial<PineToolCall> = {
        name: event.toolName,
        status:
          event.type === "tool-end"
            ? event.isError
              ? ("error" as const)
              : ("complete" as const)
            : ("running" as const),
        // A deterministic sandbox rejection of an ordinary bash call is a
        // denial (warning), not a runtime execution failure (destructive).
        ...(event.type === "tool-end" &&
        event.isError &&
        isSandboxDeniedPayload(event.payload)
          ? {
              approval: {
                state: "denied" as const,
                decidedBy: "sandbox" as const,
              },
            }
          : {}),
        ...(event.type === "tool-start" && event.payload !== undefined
          ? { input: event.payload }
          : {}),
        ...(event.type !== "tool-start" && event.payload !== undefined
          ? { output: event.payload }
          : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(event.type === "tool-end" && startedAt
          ? {
              durationMs: Math.max(0, now - new Date(startedAt).getTime()),
            }
          : {}),
      };
      messages.value[messageIndex] = {
        ...message,
        blocks: mergeToolCallBlocks(message.blocks, event.toolCallId, patch),
      };
      rememberMessageIndex(messages.value[messageIndex], messageIndex);
      return;
    }
    if (
      (event.type !== "message-start" &&
        event.type !== "message-update" &&
        event.type !== "message-end") ||
      currentSessionId !== event.sessionId
    ) {
      return;
    }

    const previousIndex = messageIndexFor(event.messageId);
    const previous =
      previousIndex >= 0 ? messages.value[previousIndex] : undefined;
    const now = Date.now();
    if (event.type === "message-update") {
      const blocks = applyAssistantMessageUpdates(
        previous?.blocks ?? [],
        event.updates,
      );
      const hasThinking = blocksHasThinking(blocks);
      const thinkingStarted = event.updates.some(
        (update) =>
          update.type === "thinking-start" || update.type === "thinking-delta",
      );
      const thinkingEnded = event.updates.some(
        (update) => update.type === "thinking-end",
      );
      const thinkingStartedAt = hasThinking
        ? (previous?.thinkingStartedAt ?? (thinkingStarted ? now : undefined))
        : undefined;
      const thinkingStatus = hasThinking
        ? thinkingEnded || previous?.thinkingStatus === "complete"
          ? ("complete" as const)
          : ("streaming" as const)
        : undefined;
      const thinkingDurationMs =
        thinkingStartedAt && thinkingStatus === "complete"
          ? (previous?.thinkingDurationMs ??
            Math.max(0, now - thinkingStartedAt))
          : undefined;
      const nextMessage: PineTranscriptMessage = {
        createdAt: previous?.createdAt ?? new Date(now).toISOString(),
        id: event.messageId,
        role: "assistant",
        status: "streaming",
        blocks,
        ...(thinkingDurationMs ? { thinkingDurationMs } : {}),
        ...(thinkingStatus ? { thinkingStatus } : {}),
        ...(thinkingStartedAt ? { thinkingStartedAt } : {}),
      };
      if (previousIndex < 0) {
        messages.value.push(nextMessage);
        rememberMessageIndex(nextMessage, messages.value.length - 1);
      } else {
        messages.value[previousIndex] = nextMessage;
        rememberMessageIndex(nextMessage, previousIndex);
      }
      return;
    }

    const role = messageRole(event.message);
    if (!role) return;
    const blocks = mergeBlockStatuses(
      parseMessageBlocks(event.message),
      previous?.blocks,
    );
    const hasThinking = blocksHasThinking(blocks);
    const thinkingStartedAt = hasThinking
      ? (previous?.thinkingStartedAt ?? now)
      : undefined;
    const thinkingEnded = event.type === "message-end";
    const thinkingStatus = hasThinking
      ? thinkingEnded || previous?.thinkingStatus === "complete"
        ? ("complete" as const)
        : ("streaming" as const)
      : undefined;
    const thinkingDurationMs =
      thinkingStartedAt && thinkingStatus === "complete"
        ? (previous?.thinkingDurationMs ?? Math.max(0, now - thinkingStartedAt))
        : undefined;
    const nextMessage: PineTranscriptMessage = {
      createdAt: messageCreatedAt(event.message),
      id: event.messageId,
      role,
      status: event.type === "message-end" ? "complete" : "streaming",
      blocks,
      ...(thinkingDurationMs ? { thinkingDurationMs } : {}),
      ...(thinkingStatus ? { thinkingStatus } : {}),
      ...(thinkingStartedAt ? { thinkingStartedAt } : {}),
    };

    if (previousIndex < 0) {
      messages.value.push(nextMessage);
      rememberMessageIndex(nextMessage, messages.value.length - 1);
    } else {
      messages.value[previousIndex] = nextMessage;
      rememberMessageIndex(nextMessage, previousIndex);
    }
  }

  function connectAgentEvents(): void {
    if (stopAgentEvents || !window.pine.onSessionEvent) return;
    stopAgentEvents = window.pine.onSessionEvent(handleAgentEvent);
  }

  function startDraft(): void {
    activationSequence += 1;
    isStartingPrompt = false;
    activeSession.value = null;
    currentSessionId = null;
    messages.value = [];
    outlineMessages.value = [];
    clearMessageIndexes();
    hasEarlierMessages.value = false;
    nextBefore.value = undefined;
    contextUsage.value = null;
    steeringMessages.value = [];
    pendingApprovals.value = [];
    pendingQuestionnaires.value = [];
    reviewingToolCallIds.value = new Set();
    isRunning.value = false;
    isLoadingMessages.value = false;
  }

  function reset(): void {
    activationSequence += 1;
    staleSessions.clear();
    sessionRunStates.clear();
    searchSequence += 1;
    recentSequence += 1;
    activeSession.value = null;
    currentSessionId = null;
    messages.value = [];
    outlineMessages.value = [];
    clearMessageIndexes();
    recentSessions.value = [];
    searchResults.value = [];
    sessionCache.clear();
    modelsStore.clearSessionSelections();
    isLoadingRecent.value = false;
    isSearching.value = false;
    isLoadingMessages.value = false;
    isRunning.value = false;
    isStartingPrompt = false;
    pendingApprovals.value = [];
    pendingQuestionnaires.value = [];
    reviewingToolCallIds.value = new Set();
    hasEarlierMessages.value = false;
    nextBefore.value = undefined;
    contextUsage.value = null;
    steeringMessages.value = [];
  }

  return {
    activeSession,
    abort,
    connectAgentEvents,
    compactContext,
    contextUsage,
    deleteSession,
    dequeueSteering,
    dropSessionCache,
    hasEarlierMessages,
    isLoadingRecent,
    isLoadingMessages,
    isRunning,
    isSearching,
    loadRecent,
    loadEarlierMessages,
    messages,
    outlineMessages,
    pendingApprovals,
    pendingQuestionnaires,
    prompt,
    recentSessions,
    renameSession,
    reset,
    respondApproval,
    respondQuestionnaire,
    resume,
    reviewingToolCallIds,
    search,
    searchResults,
    setApprovalMode,
    startDraft,
    steer,
    steeringMessages,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSessionStore, import.meta.hot));
}
