import type { ProfileVisualAsset } from "./auth";

export interface DirectMessageSearchResult {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  displayName: string;
  avatarVisual?: ProfileVisualAsset;
  isOnline?: boolean;
}

export interface DirectMessageGroupInfo {
  displayName: string;
  memberCount: number;
  members: DirectMessageSearchResult[];
}

interface DirectMessageThreadBase {
  id: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  updatedAt: string;
}

export interface DirectMessageDirectThreadSummary extends DirectMessageThreadBase {
  threadKind: "direct";
  participant: DirectMessageSearchResult;
}

export interface DirectMessageGroupThreadSummary extends DirectMessageThreadBase {
  threadKind: "group";
  group: DirectMessageGroupInfo;
}

export type DirectMessageThreadSummary =
  | DirectMessageDirectThreadSummary
  | DirectMessageGroupThreadSummary;

export type DirectMessageThreadDetail = DirectMessageThreadSummary & {
  createdAt: string;
};

export type DirectMessageAttachmentKind = "image" | "video" | "file";

export interface DirectMessageAttachment {
  id: string;
  messageId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  kind: DirectMessageAttachmentKind;
  contentUrl: string;
  downloadUrl: string;
}

export interface DirectMessageMessage {
  id: string;
  threadId: string;
  senderUserId: string;
  senderUsername: string;
  senderDisplayName: string;
  body: string;
  attachments: DirectMessageAttachment[];
  sentAt: string;
}
