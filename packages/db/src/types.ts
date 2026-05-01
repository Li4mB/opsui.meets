import type {
  LiveRole,
  MeetingDetail,
  MeetingPostSummary,
  MeetingSummary,
  ProfileVisuals,
  RoomSummary,
  SessionActor,
  WorkspaceKind,
  WorkspacePlanTier,
} from "@opsui/shared-types";

export interface RoomRecord extends RoomSummary {
  templateId: string | null;
  isPersistent: boolean;
  createdBy: string;
  createdAt: string;
}

export interface MeetingRecord extends MeetingDetail {
  createdBy: string;
}

export interface MeetingSummaryRecord extends MeetingPostSummary {
  meetingInstanceId: string;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  slug: string;
  workspaceKind: WorkspaceKind;
  organizationCode: string | null;
  organizationNameNormalized: string | null;
  planTier: WorkspacePlanTier;
  opsuiLinked: boolean;
  opsuiBusinessId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserRecord {
  id: string;
  email: string;
  username: string;
  usernameNormalized: string;
  displayName: string;
  firstName: string;
  lastName: string;
  profileVisuals?: ProfileVisuals;
  websiteLastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalAuthIdentityRecord {
  id: string;
  provider: "oidc";
  subject: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembershipRecord {
  id: string;
  workspaceId: string;
  userId: string;
  workspaceRole: LiveRole;
  membershipSource: NonNullable<SessionActor["membershipSource"]>;
  createdAt: string;
  updatedAt: string;
}

export interface UserPasswordCredentialRecord {
  userId: string;
  passwordHash: string;
  hashVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface DirectMessageThreadRecord {
  id: string;
  threadKind: "direct" | "group";
  participantKey: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface DirectMessageThreadMemberRecord {
  threadId: string;
  userId: string;
  joinedAt: string;
  lastReadMessageId: string | null;
  lastReadAt: string | null;
}

export interface DirectMessageMessageRecord {
  id: string;
  threadId: string;
  senderUserId: string;
  body: string;
  sentAt: string;
}

export interface DirectMessageAttachmentRecord {
  id: string;
  threadId: string;
  messageId: string | null;
  uploaderUserId: string;
  objectKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  kind: "image" | "video" | "file";
  createdAt: string;
}
