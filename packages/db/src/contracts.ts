import type {
  ActionItem,
  AuditLogEntry,
  AdminOverview,
  CreateActionItemInput,
  CreateTemplateInput,
  DashboardSummary,
  HookDeliveryAttempt,
  ParticipantState,
  RecordingSummary,
  TemplateSummary,
  UpdateWorkspacePolicyInput,
} from "@opsui/shared-types";
import type { RoomEvent } from "@opsui/shared-types";
import type { WorkspacePolicy } from "@opsui/shared-types";
import type { MeetingRecord, MeetingSummaryRecord, RoomRecord } from "./types";

export interface RoomsRepositoryContract {
  listByWorkspace(workspaceId: string): RoomRecord[];
  create(room: RoomRecord): RoomRecord;
  getById(id: string): RoomRecord | null;
  getBySlug(slug: string): RoomRecord | null;
}

export interface MeetingsRepositoryContract {
  listByWorkspace(workspaceId: string): MeetingRecord[];
  create(meeting: MeetingRecord): MeetingRecord;
  getById(id: string): MeetingRecord | null;
  getSummary(meetingInstanceId: string): MeetingSummaryRecord | null;
  initializeSummary(summary: MeetingSummaryRecord): MeetingSummaryRecord;
  updateSummary(
    meetingInstanceId: string,
    patch: Partial<MeetingSummaryRecord>,
  ): MeetingSummaryRecord | null;
  setStatus(
    meetingInstanceId: string,
    status: MeetingRecord["status"],
  ): MeetingRecord | null;
  setLockState(meetingInstanceId: string, isLocked: boolean): MeetingRecord | null;
}

export interface ParticipantsRepositoryContract {
  listByMeetingInstance(meetingInstanceId: string): ParticipantState[];
  registerJoin(input: {
    meetingInstanceId: string;
    displayName: string;
    presence: ParticipantState["presence"];
    role?: ParticipantState["role"];
  }): ParticipantState;
  admitToMeeting(meetingInstanceId: string, participantId: string): ParticipantState | null;
  removeFromMeeting(meetingInstanceId: string, participantId: string): ParticipantState | null;
  muteAll(meetingInstanceId: string): ParticipantState[];
  endMeeting(meetingInstanceId: string): ParticipantState[];
}

export interface RecordingsRepositoryContract {
  upsert(recording: RecordingSummary): RecordingSummary;
  getByMeetingInstanceId(meetingInstanceId: string): RecordingSummary | null;
}

export interface TemplatesRepositoryContract {
  listByWorkspace(workspaceId: string): TemplateSummary[];
  create(workspaceId: string, input: CreateTemplateInput): TemplateSummary;
}

export interface ActionItemsRepositoryContract {
  listByMeetingInstance(meetingInstanceId: string): ActionItem[];
  create(meetingInstanceId: string, input: CreateActionItemInput): ActionItem;
  complete(meetingInstanceId: string, actionItemId: string): ActionItem | null;
}

export interface DashboardRepositoryContract {
  getWorkspaceDashboard(workspaceId: string): DashboardSummary;
  getAdminOverview(workspaceId: string): AdminOverview;
}

export interface AuditRepositoryContract {
  listRecent(limit?: number): AuditLogEntry[];
  append(entry: { actor: string; action: string; target: string; occurredAt?: string }): AuditLogEntry;
}

export interface EventsRepositoryContract {
  listByMeetingInstance(meetingInstanceId: string): RoomEvent[];
  append(entry: {
    meetingInstanceId: string;
    type: RoomEvent["type"];
    actorParticipantId?: string;
    payload: RoomEvent["payload"];
  }): RoomEvent;
}

export interface PoliciesRepositoryContract {
  getWorkspacePolicy(workspaceId: string): WorkspacePolicy | null;
  updateWorkspacePolicy(workspaceId: string, input: UpdateWorkspacePolicyInput): WorkspacePolicy | null;
}

export interface HookDeliveriesRepositoryContract {
  listRecentByWorkspace(workspaceId: string, limit?: number): HookDeliveryAttempt[];
  listByMeetingInstance(meetingInstanceId: string, limit?: number): HookDeliveryAttempt[];
  append(input: Omit<HookDeliveryAttempt, "id" | "occurredAt"> & { occurredAt?: string }): HookDeliveryAttempt;
}

export interface RepositoryContext {
  rooms: RoomsRepositoryContract;
  meetings: MeetingsRepositoryContract;
  participants: ParticipantsRepositoryContract;
  recordings: RecordingsRepositoryContract;
  templates: TemplatesRepositoryContract;
  actionItems: ActionItemsRepositoryContract;
  policies: PoliciesRepositoryContract;
  hookDeliveries: HookDeliveriesRepositoryContract;
  dashboard: DashboardRepositoryContract;
  audit: AuditRepositoryContract;
  events: EventsRepositoryContract;
}

export interface RequestRepositoryContext extends RepositoryContext {
  commit(): Promise<void>;
}
