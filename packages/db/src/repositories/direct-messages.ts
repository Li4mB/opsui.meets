import {
  getMemoryStore,
  type MemoryStoreAccessor,
} from "../store";
import type {
  DirectMessageMessageRecord,
  DirectMessageThreadMemberRecord,
  DirectMessageThreadRecord,
} from "../types";

export class DirectMessagesRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  createThread(thread: DirectMessageThreadRecord): DirectMessageThreadRecord {
    this.getStore().directMessageThreads.unshift(thread);
    return thread;
  }

  addThreadMember(member: DirectMessageThreadMemberRecord): DirectMessageThreadMemberRecord {
    this.getStore().directMessageThreadMembers.unshift(member);
    return member;
  }

  getThreadById(threadId: string): DirectMessageThreadRecord | null {
    return this.getStore().directMessageThreads.find((thread) => thread.id === threadId) ?? null;
  }

  getDirectThreadByParticipantKey(participantKey: string): DirectMessageThreadRecord | null {
    return (
      this.getStore().directMessageThreads.find(
        (thread) => thread.threadKind === "direct" && thread.participantKey === participantKey,
      ) ?? null
    );
  }

  listThreadsByUser(userId: string): DirectMessageThreadRecord[] {
    const membershipThreadIds = new Set(
      this.getStore().directMessageThreadMembers
        .filter((membership) => membership.userId === userId)
        .map((membership) => membership.threadId),
    );

    return this.getStore().directMessageThreads
      .filter((thread) => membershipThreadIds.has(thread.id))
      .sort((left, right) => {
        const leftAt = Date.parse(left.lastMessageAt ?? left.updatedAt);
        const rightAt = Date.parse(right.lastMessageAt ?? right.updatedAt);
        return rightAt - leftAt;
      });
  }

  listThreadMembers(threadId: string): DirectMessageThreadMemberRecord[] {
    return this.getStore().directMessageThreadMembers.filter((membership) => membership.threadId === threadId);
  }

  getThreadMember(threadId: string, userId: string): DirectMessageThreadMemberRecord | null {
    return (
      this.getStore().directMessageThreadMembers.find(
        (membership) => membership.threadId === threadId && membership.userId === userId,
      ) ?? null
    );
  }

  updateThread(
    threadId: string,
    patch: Partial<Omit<DirectMessageThreadRecord, "id" | "participantKey" | "threadKind">>,
  ): DirectMessageThreadRecord | null {
    const thread = this.getStore().directMessageThreads.find((entry) => entry.id === threadId) ?? null;
    if (!thread) {
      return null;
    }

    Object.assign(thread, patch);
    return thread;
  }

  createMessage(message: DirectMessageMessageRecord): DirectMessageMessageRecord {
    this.getStore().directMessageMessages.unshift(message);
    return message;
  }

  listMessagesByThread(threadId: string): DirectMessageMessageRecord[] {
    return this.getStore().directMessageMessages
      .filter((message) => message.threadId === threadId)
      .sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt));
  }

  getMessageById(messageId: string): DirectMessageMessageRecord | null {
    return this.getStore().directMessageMessages.find((message) => message.id === messageId) ?? null;
  }

  markThreadRead(
    threadId: string,
    userId: string,
    input: Pick<DirectMessageThreadMemberRecord, "lastReadAt" | "lastReadMessageId">,
  ): DirectMessageThreadMemberRecord | null {
    const membership = this.getThreadMember(threadId, userId);
    if (!membership) {
      return null;
    }

    membership.lastReadAt = input.lastReadAt;
    membership.lastReadMessageId = input.lastReadMessageId;
    return membership;
  }
}
