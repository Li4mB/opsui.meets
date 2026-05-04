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
import type {
  DirectMessageAttachmentRecord,
  DirectMessageMessageRecord,
  DirectMessageThreadMemberRecord,
  DirectMessageThreadRecord,
  ExternalAuthIdentityRecord,
  MeetingRecord,
  MeetingSummaryRecord,
  RoomRecord,
  UserPasswordCredentialRecord,
  UserRecord,
  WorkspaceMembershipRecord,
  WorkspaceRecord,
} from "./types";

export interface WorkspacesRepositoryContract {
  create(workspace: WorkspaceRecord): WorkspaceRecord;
  getById(id: string): WorkspaceRecord | null;
  getBySlug(slug: string): WorkspaceRecord | null;
  getByOrganizationCode(organizationCode: string): WorkspaceRecord | null;
  getByNormalizedOrganizationName(organizationNameNormalized: string): WorkspaceRecord | null;
  getByOpsuiBusinessId(opsuiBusinessId: string): WorkspaceRecord | null;
}

export interface UsersRepositoryContract {
  create(user: UserRecord): UserRecord;
  list(): UserRecord[];
  getById(id: string): UserRecord | null;
  getByEmail(email: string): UserRecord | null;
  getByUsername(username: string): UserRecord | null;
  getByNormalizedUsername(usernameNormalized: string): UserRecord | null;
  update(userId: string, patch: Partial<Omit<UserRecord, "id" | "createdAt">>): UserRecord | null;
}

export interface WorkspaceMembershipsRepositoryContract {
  create(membership: WorkspaceMembershipRecord): WorkspaceMembershipRecord;
  listByWorkspace(workspaceId: string): WorkspaceMembershipRecord[];
  listByUser(userId: string): WorkspaceMembershipRecord[];
  getByWorkspaceAndUser(workspaceId: string, userId: string): WorkspaceMembershipRecord | null;
}

export interface PasswordCredentialsRepositoryContract {
  upsert(credential: UserPasswordCredentialRecord): UserPasswordCredentialRecord;
  getByUserId(userId: string): UserPasswordCredentialRecord | null;
}

export interface ExternalAuthIdentitiesRepositoryContract {
  create(identity: ExternalAuthIdentityRecord): ExternalAuthIdentityRecord;
  getByProviderAndSubject(provider: ExternalAuthIdentityRecord["provider"], subject: string): ExternalAuthIdentityRecord | null;
}

export interface DirectMessagesRepositoryContract {
  createThread(thread: DirectMessageThreadRecord): DirectMessageThreadRecord;
  addThreadMember(member: DirectMessageThreadMemberRecord): DirectMessageThreadMemberRecord;
  getThreadById(threadId: string): DirectMessageThreadRecord | null;
  getDirectThreadByParticipantKey(participantKey: string): DirectMessageThreadRecord | null;
  listThreadsByUser(userId: string): DirectMessageThreadRecord[];
  listThreadMembers(threadId: string): DirectMessageThreadMemberRecord[];
  getThreadMember(threadId: string, userId: string): DirectMessageThreadMemberRecord | null;
  updateThread(
    threadId: string,
    patch: Partial<Omit<DirectMessageThreadRecord, "id" | "participantKey">>,
  ): DirectMessageThreadRecord | null;
  createMessage(message: DirectMessageMessageRecord): DirectMessageMessageRecord;
  listMessagesByThread(threadId: string): DirectMessageMessageRecord[];
  getMessageById(messageId: string): DirectMessageMessageRecord | null;
  createAttachment(attachment: DirectMessageAttachmentRecord): DirectMessageAttachmentRecord;
  listAttachmentsByThread(threadId: string): DirectMessageAttachmentRecord[];
  listAttachmentsByMessage(messageId: string): DirectMessageAttachmentRecord[];
  getAttachmentById(messageId: string): DirectMessageAttachmentRecord | null;
  updateAttachment(
    attachmentId: string,
    patch: Partial<Pick<DirectMessageAttachmentRecord, "messageId">>,
  ): DirectMessageAttachmentRecord | null;
  markThreadRead(
    threadId: string,
    userId: string,
    input: Pick<DirectMessageThreadMemberRecord, "lastReadAt" | "lastReadMessageId">,
  ): DirectMessageThreadMemberRecord | null;
}

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
  // Sweeps stale session leases into a recoverable reconnecting state before a later terminal expiry.
  // This prevents brief transport/background interruptions from being treated like explicit leaves.
  listByMeetingInstance(meetingInstanceId: string): ParticipantState[];
  registerJoin(input: {
    meetingInstanceId: string;
    displayName: string;
    joinSessionId?: string;
    presence: ParticipantState["presence"];
    role?: ParticipantState["role"];
  }): ParticipantState;
  touchSessionLease(
    meetingInstanceId: string,
    participantId: string,
    joinSessionId?: string,
  ): ParticipantState | null;
  expireStaleSessions(
    meetingInstanceId: string,
    options?: {
      now?: Date;
      reconnectGraceMs?: number;
      staleAfterMs?: number;
    },
  ): Array<{
    action: "expired" | "reconnecting";
    participant: ParticipantState;
  }>;
  admitToMeeting(meetingInstanceId: string, participantId: string): ParticipantState | null;
  leaveMeeting(meetingInstanceId: string, participantId: string): ParticipantState | null;
  removeFromMeeting(meetingInstanceId: string, participantId: string): ParticipantState | null;
  muteAll(meetingInstanceId: string): ParticipantState[];
  endMeeting(meetingInstanceId: string): ParticipantState[];
}

export interface RecordingsRepositoryContract {
  upsert(recording: RecordingSummary): RecordingSummary;
  getByMeetingInstanceId(meetingInstanceId: string): RecordingSummary | null;
  getById(recordingId: string): RecordingSummary | null;
  listByOwnerUserId(ownerUserId: string): RecordingSummary[];
  updateSaved(recordingId: string, ownerUserId: string, saved: boolean): RecordingSummary | null;
  deleteById(recordingId: string, ownerUserId?: string): RecordingSummary | null;
  pruneExpired(now?: Date): string[];
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
  workspaces: WorkspacesRepositoryContract;
  users: UsersRepositoryContract;
  workspaceMemberships: WorkspaceMembershipsRepositoryContract;
  passwordCredentials: PasswordCredentialsRepositoryContract;
  externalAuthIdentities: ExternalAuthIdentitiesRepositoryContract;
  directMessages: DirectMessagesRepositoryContract;
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
