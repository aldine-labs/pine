import type {
  AbortSessionResult,
  CompactSessionResult,
  DequeueSteeringRequest,
  DequeueSteeringResult,
  PromptSessionRequest,
  PromptSessionResult,
  RespondApprovalRequest,
  RespondQuestionnaireRequest,
  SetApprovalModeRequest,
  SetApprovalModeResult,
  SessionEventListener,
} from "./agent";
import type {
  PineContextCompactionStrategy,
  SetContextCompactionStrategyRequest,
  SetContextCompactionStrategyResult,
} from "./preferences";
import type {
  InspectAttachmentsRequest,
  OpenAttachmentRequest,
  OpenAttachmentResult,
  PickAttachmentsResult,
  SavePastedAttachmentRequest,
  SavePastedAttachmentResult,
} from "./attachments";
import type {
  AddCustomModelRequest,
  LoginProviderRequest,
  LogoutProviderRequest,
  LookupModelMetadataRequest,
  PineModelCatalog,
  PineModelMetadata,
  ProviderAuthEventListener,
  ProviderAuthResponseRequest,
  ProviderLoginResult,
  SelectModelRequest,
  SelectUtilityModelRequest,
} from "./models";
import type {
  ProjectEntryReference,
  ProjectFilePreview,
  ProjectFilePreviewRequest,
  PresentedFilePreviewRequest,
  ProjectFileOperation,
  ListProjectDirectoryRequest,
  ListProjectDirectoryResult,
  ProjectFilesChangedEvent,
  SetWatchedProjectDirectoriesRequest,
} from "./projectFiles";
import type {
  AttachSessionRequest,
  AttachSessionResult,
  DeleteSessionRequest,
  DeleteSessionResult,
  ExportSessionRequest,
  ExportSessionResult,
  LoadSessionMessagesRequest,
  LoadSessionMessagesResult,
  RenameSessionRequest,
  RenameSessionResult,
  ResumeSessionRequest,
  ResumeSessionResult,
  SearchSessionsRequest,
  SearchSessionsResult,
} from "./sessions";
import type { PineWindowApi } from "./window";
import type { PineUserProfile, SetUserProfileResult } from "./userProfile";
import type {
  SetTinyFishApiKeyRequest,
  SetTinyFishApiKeyResult,
  TinyFishCredentialStatus,
} from "./tinyfish";

export const PROJECTS_DIRECTORY = "projects" as const;
export const PROJECT_METADATA_FILE = "project.json" as const;
export const PROJECT_SESSIONS_DIRECTORY = "sessions" as const;
export const PROJECT_CACHE_DIRECTORY = "cache" as const;
/** Pine-managed storage for attachments pasted without a filesystem path. */
export const PROJECT_ATTACHMENTS_DIRECTORY = "attachments" as const;

export const LIST_PROJECTS_CHANNEL = "project:list" as const;
export const CREATE_PROJECT_CHANNEL = "project:create" as const;
export const CLOSE_PROJECT_CHANNEL = "project:close" as const;
export const OPEN_PROJECT_CHANNEL = "project:open" as const;
export const UPDATE_PROJECT_CHANNEL = "project:update" as const;
export const DELETE_PROJECT_CHANNEL = "project:delete" as const;
export const PICK_PROJECT_FOLDERS_CHANNEL = "project:pick-folders" as const;

export type ProjectFolderAccess = "read-only" | "read-write";

export interface ProjectFolderInput {
  access: ProjectFolderAccess;
  id: string;
  name: string;
  path: string;
}

export interface PineProjectFolder extends ProjectFolderInput {
  isAvailable: boolean;
}

export interface PineProject {
  createdAt: string;
  defaultFolderId: string;
  folders: PineProjectFolder[];
  id: string;
  lastOpenedAt?: string;
  name: string;
  schemaVersion: 1;
  updatedAt: string;
}

export interface ProjectMutationInput {
  defaultFolderId: string;
  folders: ProjectFolderInput[];
  name: string;
}

export type CreateProjectRequest = ProjectMutationInput;

export interface UpdateProjectRequest extends ProjectMutationInput {
  id: string;
}

export interface ProjectIdRequest {
  id: string;
}

export interface ListProjectsResult {
  projects: PineProject[];
}

export interface ProjectResult {
  project: PineProject;
}

export interface OpenProjectResult extends ProjectResult {
  /** Whether this window now owns the project runtime. */
  opened: boolean;
}

export interface DeleteProjectResult {
  deleted: boolean;
}

export interface PickProjectFoldersResult {
  folders: ProjectFolderInput[];
}

export interface PickProjectFoldersRequest {
  mode: "context" | "default";
}

export interface PineDesktopApi extends PineWindowApi {
  readProjectFilePreview: (
    request: ProjectFilePreviewRequest,
  ) => Promise<ProjectFilePreview>;
  readPresentedFilePreview: (
    request: PresentedFilePreviewRequest,
  ) => Promise<ProjectFilePreview>;
  abortSession: () => Promise<AbortSessionResult>;
  attachSession: (
    request: AttachSessionRequest,
  ) => Promise<AttachSessionResult>;
  compactSession: () => Promise<CompactSessionResult>;
  dequeueSteering: (
    request: DequeueSteeringRequest,
  ) => Promise<DequeueSteeringResult>;
  closeProject: () => Promise<void>;
  createProject: (request: CreateProjectRequest) => Promise<ProjectResult>;
  deleteProject: (request: ProjectIdRequest) => Promise<DeleteProjectResult>;
  deleteSession: (
    request: DeleteSessionRequest,
  ) => Promise<DeleteSessionResult>;
  exportSession: (
    request: ExportSessionRequest,
  ) => Promise<ExportSessionResult>;
  listProjectDirectory: (
    request: ListProjectDirectoryRequest,
  ) => Promise<ListProjectDirectoryResult>;
  setWatchedProjectDirectories: (
    request: SetWatchedProjectDirectoriesRequest,
  ) => Promise<void>;
  onProjectFilesChanged: (
    listener: (event: ProjectFilesChangedEvent) => void,
  ) => () => void;
  operateProjectFile: (request: ProjectFileOperation) => Promise<void>;
  inspectProjectAttachments: (
    entries: ProjectEntryReference[],
  ) => Promise<PickAttachmentsResult>;
  listProjects: () => Promise<ListProjectsResult>;
  getModelCatalog: () => Promise<PineModelCatalog>;
  lookupModelMetadata: (
    request: LookupModelMetadataRequest,
  ) => Promise<PineModelMetadata>;
  addCustomModel: (request: AddCustomModelRequest) => Promise<PineModelCatalog>;
  getContextCompactionStrategy: () => Promise<PineContextCompactionStrategy>;
  getUserProfile: () => Promise<PineUserProfile>;
  getTinyFishCredentialStatus: () => Promise<TinyFishCredentialStatus>;
  setTinyFishApiKey: (
    request: SetTinyFishApiKeyRequest,
  ) => Promise<SetTinyFishApiKeyResult>;
  setContextCompactionStrategy: (
    request: SetContextCompactionStrategyRequest,
  ) => Promise<SetContextCompactionStrategyResult>;
  setUserProfile: (profile: PineUserProfile) => Promise<SetUserProfileResult>;
  getPathForFile: (file: File) => string;
  inspectAttachments: (
    request: InspectAttachmentsRequest,
  ) => Promise<PickAttachmentsResult>;
  openAttachment: (
    request: OpenAttachmentRequest,
  ) => Promise<OpenAttachmentResult>;
  savePastedAttachment: (
    request: SavePastedAttachmentRequest,
  ) => Promise<SavePastedAttachmentResult>;
  loginProvider: (
    request: LoginProviderRequest,
  ) => Promise<ProviderLoginResult>;
  respondToProviderAuth: (
    request: ProviderAuthResponseRequest,
  ) => Promise<{ accepted: boolean }>;
  cancelProviderAuth: (request: {
    loginId: string;
  }) => Promise<{ cancelled: boolean }>;
  logoutProvider: (
    request: LogoutProviderRequest,
  ) => Promise<{ disposed: boolean }>;
  selectModel: (request: SelectModelRequest) => Promise<{ disposed: boolean }>;
  selectUtilityModel: (
    request: SelectUtilityModelRequest,
  ) => Promise<{ updated: boolean }>;
  openProviderAuthUrl: (url: string) => Promise<void>;
  onProviderAuthEvent: (listener: ProviderAuthEventListener) => () => void;
  loadSessionMessages: (
    request: LoadSessionMessagesRequest,
  ) => Promise<LoadSessionMessagesResult>;
  openProject: (request: ProjectIdRequest) => Promise<OpenProjectResult>;
  pickAttachments: () => Promise<PickAttachmentsResult>;
  pickAttachmentFolders: () => Promise<PickAttachmentsResult>;
  pickProjectFolders: (
    request: PickProjectFoldersRequest,
  ) => Promise<PickProjectFoldersResult>;
  promptSession: (
    request: PromptSessionRequest,
  ) => Promise<PromptSessionResult>;
  resumeSession: (
    request: ResumeSessionRequest,
  ) => Promise<ResumeSessionResult>;
  renameSession: (
    request: RenameSessionRequest,
  ) => Promise<RenameSessionResult>;
  searchSessions: (
    request: SearchSessionsRequest,
  ) => Promise<SearchSessionsResult>;
  onSessionEvent: (listener: SessionEventListener) => () => void;
  respondApproval: (
    request: RespondApprovalRequest,
  ) => Promise<{ accepted: boolean }>;
  respondQuestionnaire: (
    request: RespondQuestionnaireRequest,
  ) => Promise<{ accepted: boolean }>;
  setApprovalMode: (
    request: SetApprovalModeRequest,
  ) => Promise<SetApprovalModeResult>;
  updateProject: (request: UpdateProjectRequest) => Promise<ProjectResult>;
}
