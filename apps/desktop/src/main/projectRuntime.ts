import type {
  ProjectEntryReference,
  ProjectFileOperation,
  ProjectEntry,
} from "../shared/projectFiles";
import type { PineProject, PineProjectFolder } from "../shared/projects";
import type { PineContextCompactionStrategy } from "../shared/preferences";
import type {
  PineApprovalMode,
  PromptSessionRequest,
  PromptSessionResult,
  RespondApprovalRequest,
} from "../shared/agent";
import type {
  AddCustomModelRequest,
  LoginProviderRequest,
  PineModelCatalog,
  ProviderLoginResult,
  SelectModelRequest,
  SelectUtilityModelRequest,
} from "../shared/models";
import type {
  LoadSessionMessagesResult,
  PineContextUsage,
  PineSessionSummary,
  ResumeSessionResult,
  SessionSearchResult,
} from "../shared/sessions";
import {
  operateProjectFile,
  resolveProjectEntry,
  type ProjectFileNativeActions,
} from "./projectFileOperations";
import { listProjectDirectory, resolveProjectPath } from "./projectFiles";
import type { ProjectDataPaths } from "./projects/projectRepository";
import {
  ProjectSessionService,
  type PineSessionExportDocument,
} from "./sessions";
import type { AgentHost } from "./agentProcessHost";
import type { GateDecision } from "../agent/protocol";
import {
  parseAttachmentMessage,
  type PineAttachment,
} from "../shared/attachments";
import path from "node:path";

function pathContains(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(
    path.resolve(parentPath),
    path.resolve(candidatePath),
  );
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

/** Maps the renderer's approval action to the worker-side gate decision. */
function toGateDecision(request: RespondApprovalRequest): GateDecision {
  if (request.action === "approve") return { kind: "allow" };
  const guidance = request.guidance?.trim();
  if (request.action === "guide" && guidance) {
    return {
      kind: "deny",
      reason: `The user rejected this call with guidance: ${guidance}`,
    };
  }
  return { kind: "deny", reason: "The user rejected this tool call." };
}

type RuntimeSessionState =
  | { status: "idle" }
  | {
      status: "creating";
      promise: Promise<PineSessionSummary>;
    }
  | {
      status: "active";
      summary: PineSessionSummary;
      contextUsage?: PineContextUsage;
    };

interface ProjectRuntime {
  approvalMode: PineApprovalMode;
  dataPaths: ProjectDataPaths;
  project: PineProject;
  session: RuntimeSessionState;
  sessions: ProjectSessionService;
}

export class ProjectRuntimeRegistry {
  private readonly runtimes = new Map<number, ProjectRuntime>();
  /** approval requestId → owning webContentsId, for response validation. */
  private readonly pendingApprovals = new Map<string, number>();

  constructor(
    private readonly agentHost: AgentHost,
    private readonly agentDir: string,
    private readonly getTinyFishApiKey: () => string | undefined = () =>
      undefined,
  ) {}

  async open(
    webContentsId: number,
    project: PineProject,
    dataPaths: ProjectDataPaths,
  ): Promise<void> {
    const defaultFolder = project.folders.find(
      (folder) => folder.id === project.defaultFolderId,
    );
    if (!defaultFolder?.isAvailable) {
      throw new Error("The project's default folder is unavailable.");
    }

    await this.dispose(webContentsId);

    const sessions = await ProjectSessionService.create({
      cacheRoot: dataPaths.cacheRoot,
      cwd: defaultFolder.path,
      sessionsRoot: dataPaths.sessionsRoot,
    });
    this.runtimes.set(webContentsId, {
      approvalMode: "auto-approve",
      dataPaths,
      project,
      session: { status: "idle" },
      sessions,
    });
  }

  isOpen(webContentsId: number, projectId: string): boolean {
    return this.runtimes.get(webContentsId)?.project.id === projectId;
  }

  /** Attachment storage root for the project open in this window. */
  attachmentsRootFor(webContentsId: number): string | undefined {
    return this.runtimes.get(webContentsId)?.dataPaths.attachmentsRoot;
  }

  /**
   * Whether a filesystem path sits inside a folder the user granted to one
   * of the currently open projects. Used to scope which attachment images
   * the `pine-attachment://` protocol is allowed to serve.
   */
  isInsideGrantedFolder(candidatePath: string): boolean {
    const resolvedPath = path.resolve(candidatePath);
    for (const runtime of this.runtimes.values()) {
      for (const folder of runtime.project.folders) {
        if (pathContains(folder.path, resolvedPath)) return true;
      }
    }
    return false;
  }

  async search(
    webContentsId: number,
    query: string,
  ): Promise<SessionSearchResult[]> {
    return this.get(webContentsId).sessions.search(query);
  }

  async loadMessages(
    webContentsId: number,
    sessionId: string,
    before?: string,
    limit?: number,
  ): Promise<LoadSessionMessagesResult> {
    return this.get(webContentsId).sessions.loadMessages(
      sessionId,
      before,
      limit,
    );
  }

  async attachmentForSession(
    webContentsId: number,
    sessionId: string,
  ): Promise<PineAttachment> {
    return this.get(webContentsId).sessions.attachmentForSession(sessionId);
  }

  async exportSession(
    webContentsId: number,
    sessionId: string,
  ): Promise<PineSessionExportDocument> {
    const runtime = this.get(webContentsId);
    const fallbackApprovalMode =
      runtime.session.status === "active" &&
      runtime.session.summary.id === sessionId
        ? runtime.approvalMode
        : "auto-approve";
    return runtime.sessions.exportSession(sessionId, fallbackApprovalMode);
  }

  async deleteSession(
    webContentsId: number,
    sessionId: string,
  ): Promise<boolean> {
    const runtime = this.get(webContentsId);
    if (
      runtime.session.status === "active" &&
      runtime.session.summary.id === sessionId
    ) {
      await this.releaseSession(runtime);
    }
    return runtime.sessions.deleteSession(sessionId);
  }

  async renameSession(
    webContentsId: number,
    sessionId: string,
    name: string,
  ): Promise<PineSessionSummary> {
    const runtime = this.get(webContentsId);
    if (
      runtime.session.status === "active" &&
      runtime.session.summary.id === sessionId
    ) {
      const result = await this.agentHost.renameSession(sessionId, name);
      runtime.session.summary = result.session;
      return result.session;
    }
    return runtime.sessions.renameSession(sessionId, name);
  }

  async projectEntryPaths(
    webContentsId: number,
    entries: ProjectEntryReference[],
  ): Promise<string[]> {
    const { project } = this.get(webContentsId);
    return Promise.all(
      entries.map((entry) => resolveProjectEntry(project.folders, entry)),
    );
  }

  async operateFile(
    webContentsId: number,
    request: ProjectFileOperation,
    native: ProjectFileNativeActions,
  ): Promise<void> {
    const { project } = this.get(webContentsId);
    await operateProjectFile(project.folders, request, native);
  }

  async listDirectory(
    webContentsId: number,
    folderId: string,
    relativePath: string,
  ): Promise<ProjectEntry[]> {
    const runtime = this.get(webContentsId);
    return listProjectDirectory(
      this.getFolder(runtime.project, folderId),
      relativePath,
    );
  }

  async resolveDirectory(
    webContentsId: number,
    folderId: string,
    relativePath: string,
  ): Promise<string> {
    const runtime = this.get(webContentsId);
    return resolveProjectPath(
      this.getFolder(runtime.project, folderId),
      relativePath,
    );
  }

  async resume(
    webContentsId: number,
    sessionId: string,
  ): Promise<ResumeSessionResult> {
    const runtime = this.get(webContentsId);
    if (
      runtime.session.status === "active" &&
      runtime.session.summary.id === sessionId
    ) {
      return {
        session: runtime.session.summary,
        ...(runtime.session.contextUsage
          ? { contextUsage: runtime.session.contextUsage }
          : {}),
      };
    }

    const descriptor = await runtime.sessions.describeSession(sessionId);
    await this.releaseSession(runtime);
    const opened = await this.agentHost.openSession(
      this.location(runtime),
      descriptor.sessionFile,
    );
    runtime.session = {
      status: "active",
      summary: opened.session,
      ...(opened.contextUsage ? { contextUsage: opened.contextUsage } : {}),
    };
    return {
      session: opened.session,
      ...(opened.contextUsage ? { contextUsage: opened.contextUsage } : {}),
    };
  }

  private async ensureActiveSession(
    webContentsId: number,
  ): Promise<PineSessionSummary> {
    const runtime = this.get(webContentsId);
    if (runtime.session.status === "active") {
      return runtime.session.summary;
    }
    if (runtime.session.status === "creating") return runtime.session.promise;

    const creation = this.agentHost
      .createSession(this.location(runtime))
      .then(({ session }) => session);
    runtime.session = { status: "creating", promise: creation };

    try {
      const session = await creation;
      if (this.runtimes.get(webContentsId) !== runtime) {
        throw new Error("The active project changed while creating a session.");
      }
      if (
        runtime.session.status !== "creating" ||
        runtime.session.promise !== creation
      ) {
        throw new Error("Session creation was superseded.");
      }

      runtime.session = { status: "active", summary: session };
      return session;
    } catch (error) {
      if (
        runtime.session.status === "creating" &&
        runtime.session.promise === creation
      ) {
        runtime.session = { status: "idle" };
      }
      throw error;
    }
  }

  private async createNewSession(
    webContentsId: number,
  ): Promise<PineSessionSummary> {
    const runtime = this.get(webContentsId);
    await this.releaseSession(runtime);
    return this.ensureActiveSession(webContentsId);
  }

  async prompt(
    webContentsId: number,
    request: PromptSessionRequest,
  ): Promise<PromptSessionResult> {
    const runtime = this.get(webContentsId);
    runtime.approvalMode = request.approvalMode ?? "auto-approve";
    const activeSession =
      request.target.kind === "new"
        ? await this.createNewSession(webContentsId)
        : (await this.resume(webContentsId, request.target.sessionId)).session;
    const attachedPaths = parseAttachmentMessage(request.message)
      .attachments.map((attachment) => attachment.path)
      .filter((attachmentPath) => attachmentPath.length <= 4_096)
      .slice(0, 100);
    const streamingBehavior =
      request.streamingBehavior === "follow-up"
        ? "followUp"
        : request.streamingBehavior;
    const promptArguments = [
      activeSession.id,
      request.message,
      streamingBehavior,
      attachedPaths.length > 0 ? attachedPaths : undefined,
      runtime.approvalMode,
      ...(request.locale ? [request.locale] : []),
    ] as const;
    const result = await this.agentHost.prompt(...promptArguments);
    if (
      runtime.session.status === "active" &&
      runtime.session.summary.id === result.session.id
    ) {
      runtime.session = { status: "active", summary: result.session };
    }
    return { accepted: result.accepted, session: result.session };
  }

  async abort(webContentsId: number): Promise<{
    aborted: boolean;
    sessionId?: string;
  }> {
    const runtime = this.get(webContentsId);
    if (runtime.session.status !== "active") return { aborted: false };
    const sessionId = runtime.session.summary.id;
    const result = await this.agentHost.abort(sessionId);
    return { ...result, sessionId };
  }

  async compact(webContentsId: number): Promise<{ compacted: boolean }> {
    const runtime = this.get(webContentsId);
    if (runtime.session.status !== "active") return { compacted: false };
    return this.agentHost.compact(runtime.session.summary.id);
  }

  async dequeueSteering(
    webContentsId: number,
    message: string,
  ): Promise<{ message?: string; removed: boolean }> {
    const runtime = this.get(webContentsId);
    if (runtime.session.status !== "active") return { removed: false };
    return this.agentHost.dequeueSteering(runtime.session.summary.id, message);
  }

  async setApprovalMode(
    webContentsId: number,
    approvalMode: PineApprovalMode,
  ): Promise<{ updated: boolean }> {
    const runtime = this.get(webContentsId);
    runtime.approvalMode = approvalMode;
    if (runtime.session.status !== "active") return { updated: false };
    return this.agentHost.setApprovalMode(
      runtime.session.summary.id,
      approvalMode,
    );
  }

  getModelCatalog(): Promise<PineModelCatalog> {
    return this.agentHost.getModelCatalog(this.agentDir);
  }

  addCustomModel(request: AddCustomModelRequest): Promise<PineModelCatalog> {
    return this.agentHost.addCustomModel(this.agentDir, request);
  }

  loginProvider(request: LoginProviderRequest): Promise<ProviderLoginResult> {
    return this.agentHost.loginProvider(this.agentDir, request);
  }

  respondToProviderAuth(
    loginId: string,
    promptId: string,
    value: string,
  ): Promise<{ accepted: boolean }> {
    return this.agentHost.respondToProviderAuth(loginId, promptId, value);
  }

  cancelProviderAuth(loginId: string): Promise<{ cancelled: boolean }> {
    return this.agentHost.cancelProviderAuth(loginId);
  }

  logoutProvider(providerId: string): Promise<{ disposed: boolean }> {
    return this.agentHost.logoutProvider(this.agentDir, providerId);
  }

  async selectModel(
    webContentsId: number,
    request: SelectModelRequest,
  ): Promise<{ disposed: boolean }> {
    if (request.sessionId) {
      await this.resume(webContentsId, request.sessionId);
    }
    return this.agentHost.selectModel(
      this.agentDir,
      request.providerId,
      request.modelId,
      request.thinkingLevel,
      request.sessionId,
    );
  }

  selectUtilityModel(
    request: SelectUtilityModelRequest,
  ): Promise<{ updated: boolean }> {
    return this.agentHost.selectUtilityModel(this.agentDir, request);
  }

  setTinyFishApiKey(apiKey: string | undefined): Promise<{ updated: boolean }> {
    return this.agentHost.setTinyFishApiKey(apiKey);
  }

  setContextCompactionStrategy(
    strategy: PineContextCompactionStrategy,
  ): Promise<{ updated: boolean }> {
    const hasActiveSession = [...this.runtimes.values()].some(
      (runtime) => runtime.session.status === "active",
    );
    if (!hasActiveSession) return Promise.resolve({ updated: true });
    return this.agentHost.setContextCompactionStrategy(strategy);
  }

  ownerOfSession(sessionId: string): number | undefined {
    for (const [webContentsId, runtime] of this.runtimes) {
      if (this.activeSessionId(runtime) === sessionId) return webContentsId;
    }
    return undefined;
  }

  updateContextUsage(sessionId: string, contextUsage: PineContextUsage): void {
    for (const runtime of this.runtimes.values()) {
      if (
        runtime.session.status === "active" &&
        runtime.session.summary.id === sessionId
      ) {
        runtime.session.contextUsage = contextUsage;
        return;
      }
    }
  }

  updateSessionSummary(sessionId: string, summary: PineSessionSummary): void {
    for (const runtime of this.runtimes.values()) {
      if (
        runtime.session.status === "active" &&
        runtime.session.summary.id === sessionId
      ) {
        runtime.session.summary = summary;
        return;
      }
    }
  }

  /** Remember which window an approval request was routed to. */
  trackApproval(requestId: string, webContentsId: number): void {
    this.pendingApprovals.set(requestId, webContentsId);
  }

  forgetApproval(requestId: string): void {
    this.pendingApprovals.delete(requestId);
  }

  respondApproval(
    webContentsId: number,
    request: RespondApprovalRequest,
  ): { accepted: boolean } {
    const owner = this.pendingApprovals.get(request.requestId);
    if (owner === undefined) {
      throw new Error("This approval request is no longer pending.");
    }
    if (owner !== webContentsId) {
      throw new Error("Approval request does not belong to this window.");
    }
    this.pendingApprovals.delete(request.requestId);
    this.agentHost.respondApproval(request.requestId, toGateDecision(request));
    return { accepted: true };
  }

  async dispose(webContentsId: number): Promise<void> {
    const runtime = this.runtimes.get(webContentsId);
    if (!runtime) return;

    for (const [requestId, owner] of this.pendingApprovals) {
      if (owner === webContentsId) this.pendingApprovals.delete(requestId);
    }
    this.runtimes.delete(webContentsId);
    await this.releaseSession(runtime);
    await runtime.sessions.dispose();
  }

  private activeSessionId(runtime?: ProjectRuntime): string | undefined {
    return runtime?.session.status === "active"
      ? runtime.session.summary.id
      : undefined;
  }

  private async releaseSession(runtime: ProjectRuntime): Promise<void> {
    const session = runtime.session;
    runtime.session = { status: "idle" };

    if (session.status === "idle") return;
    const sessionId =
      session.status === "active"
        ? session.summary.id
        : await session.promise.then(
            (summary) => summary.id,
            () => undefined,
          );
    if (sessionId) await this.agentHost.disposeSession(sessionId);
  }

  private get(webContentsId: number): ProjectRuntime {
    const runtime = this.runtimes.get(webContentsId);
    if (!runtime) throw new Error("No project is open in this window.");
    return runtime;
  }

  private getFolder(project: PineProject, folderId: string): PineProjectFolder {
    const folder = project.folders.find(
      (candidate) => candidate.id === folderId,
    );
    if (!folder) throw new Error("Folder not found in the active project.");
    return folder;
  }

  private location(runtime: ProjectRuntime) {
    const tinyFishApiKey = this.getTinyFishApiKey();
    const defaultFolder = this.getFolder(
      runtime.project,
      runtime.project.defaultFolderId,
    );
    return {
      agentDir: this.agentDir,
      approvalMode: runtime.approvalMode,
      cwd: defaultFolder.path,
      folders: runtime.project.folders
        .filter((folder) => folder.isAvailable)
        .map(({ access, path: folderPath }) => ({
          access,
          path: folderPath,
        })),
      sessionsRoot: runtime.dataPaths.sessionsRoot,
      ...(tinyFishApiKey ? { tinyFishApiKey } : {}),
    };
  }
}
