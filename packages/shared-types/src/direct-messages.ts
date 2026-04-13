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

export interface DirectMessageMessage {
  id: string;
  threadId: string;
  senderUserId: string;
  senderUsername: string;
  senderDisplayName: string;
  body: string;
  sentAt: string;
}
