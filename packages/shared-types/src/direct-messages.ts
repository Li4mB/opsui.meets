export interface DirectMessageSearchResult {
  userId: string;
  username: string;
  firstName: string;
  lastName: string;
  displayName: string;
}

export interface DirectMessageThreadSummary {
  id: string;
  threadKind: "direct";
  participant: DirectMessageSearchResult;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  updatedAt: string;
}

export interface DirectMessageThreadDetail extends DirectMessageThreadSummary {
  createdAt: string;
}

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
