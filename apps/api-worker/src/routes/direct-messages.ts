import type {
  DirectMessageMessage,
  DirectMessageSearchResult,
  DirectMessageThreadDetail,
  DirectMessageThreadSummary,
} from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import { ApiError, json } from "../lib/http";
import { enforceRateLimit } from "../lib/rate-limit";
import { parseJson, requireNonEmptyString } from "../lib/request";
import type { Env } from "../types";

const MAX_DIRECT_MESSAGE_LENGTH = 2_000;
const DIRECT_MESSAGE_PREVIEW_LIMIT = 120;
const SEARCH_RESULT_LIMIT = 20;

export async function listDirectMessageThreads(request: Request, env: Env): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "dm-threads",
    limit: 120,
    windowMs: 60_000,
  });

  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const repositories = await getRepositories(env);
  const items = repositories.directMessages
    .listThreadsByUser(userId)
    .map((thread) => buildThreadSummary(thread.id, userId, repositories))
    .filter(Boolean);

  const response = json({ items });
  recordApiMetric(env, {
    route: "dm-threads",
    status: response.status,
    request,
    outcome: "listed",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function searchDirectMessageUsers(request: Request, env: Env): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "dm-search",
    limit: 120,
    windowMs: 60_000,
  });

  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const url = new URL(request.url);
  const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
  if (!query) {
    const response = json({ items: [] satisfies DirectMessageSearchResult[] });
    recordApiMetric(env, {
      route: "dm-search",
      status: response.status,
      request,
      outcome: "empty_query",
      workspaceId: actor.workspaceId,
    });
    return response;
  }

  const repositories = await getRepositories(env);
  const items = repositories.users
    .list()
    .filter((user) => user.id !== userId)
    .map((user) => ({
      score: getUsernameMatchScore(user.usernameNormalized, query),
      user,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.user.usernameNormalized.localeCompare(right.user.usernameNormalized);
    })
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((entry) => buildSearchResult(entry.user));

  const response = json({ items });
  recordApiMetric(env, {
    route: "dm-search",
    status: response.status,
    request,
    outcome: items.length ? "results" : "no_results",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function createOrGetDirectMessageThread(request: Request, env: Env): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "dm-thread-open",
    limit: 60,
    windowMs: 60_000,
  });

  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<{ username: string }>(request);
  const username = requireNonEmptyString(payload.username, "username_required");
  const target = repositories.users.getByUsername(username);

  if (!target) {
    throw new ApiError(404, "user_not_found", "No account matches that username.");
  }

  if (target.id === userId) {
    throw new ApiError(400, "cannot_message_self", "Choose someone else to start a direct message.");
  }

  const participantKey = buildParticipantKey(userId, target.id);
  let thread = repositories.directMessages.getDirectThreadByParticipantKey(participantKey);
  let created = false;

  if (!thread) {
    const now = new Date().toISOString();
    thread = repositories.directMessages.createThread({
      id: crypto.randomUUID(),
      threadKind: "direct",
      participantKey,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
      lastMessagePreview: null,
    });
    repositories.directMessages.addThreadMember({
      threadId: thread.id,
      userId,
      joinedAt: now,
      lastReadAt: null,
      lastReadMessageId: null,
    });
    repositories.directMessages.addThreadMember({
      threadId: thread.id,
      userId: target.id,
      joinedAt: now,
      lastReadAt: null,
      lastReadMessageId: null,
    });
    created = true;
  }

  await repositories.commit();

  const detail = buildThreadDetail(thread.id, userId, repositories);
  if (!detail) {
    throw new ApiError(500, "thread_unavailable", "The direct message thread could not be opened.");
  }

  const response = json(detail, { status: created ? 201 : 200 });
  recordApiMetric(env, {
    route: "dm-thread-open",
    status: response.status,
    request,
    outcome: created ? "created" : "existing",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function getDirectMessageThread(
  request: Request,
  threadId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const repositories = await getRepositories(env);
  const detail = buildThreadDetail(threadId, userId, repositories);

  if (!detail) {
    throw new ApiError(404, "thread_not_found", "That direct message thread was not found.");
  }

  const response = json(detail);
  recordApiMetric(env, {
    route: "dm-thread-detail",
    status: response.status,
    request,
    outcome: "loaded",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function listDirectMessageMessages(
  request: Request,
  threadId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const repositories = await getRepositories(env);

  assertThreadMembership(repositories.directMessages.getThreadMember(threadId, userId));

  const items = repositories.directMessages
    .listMessagesByThread(threadId)
    .map((message) => {
      const sender = repositories.users.getById(message.senderUserId);
      if (!sender) {
        return null;
      }

      return {
        id: message.id,
        threadId: message.threadId,
        senderUserId: message.senderUserId,
        senderUsername: sender.username,
        senderDisplayName: sender.displayName,
        body: message.body,
        sentAt: message.sentAt,
      } satisfies DirectMessageMessage;
    })
    .filter(Boolean);

  const response = json({ items });
  recordApiMetric(env, {
    route: "dm-thread-messages",
    status: response.status,
    request,
    outcome: "listed",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function sendDirectMessage(
  request: Request,
  threadId: string,
  env: Env,
): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "dm-send",
    limit: 120,
    windowMs: 60_000,
  });

  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const repositories = await getRepositories(env);
  const membership = repositories.directMessages.getThreadMember(threadId, userId);
  assertThreadMembership(membership);

  const payload = await parseJson<{ text: string }>(request);
  const text = requireNonEmptyString(payload.text, "message_text_required");
  if (text.length > MAX_DIRECT_MESSAGE_LENGTH) {
    throw new ApiError(
      400,
      "message_too_long",
      `Direct messages must be ${MAX_DIRECT_MESSAGE_LENGTH} characters or fewer.`,
    );
  }

  const now = new Date().toISOString();
  const message = repositories.directMessages.createMessage({
    id: crypto.randomUUID(),
    threadId,
    senderUserId: userId,
    body: text,
    sentAt: now,
  });

  repositories.directMessages.updateThread(threadId, {
    lastMessageAt: now,
    lastMessagePreview: createMessagePreview(text),
    updatedAt: now,
  });
  repositories.directMessages.markThreadRead(threadId, userId, {
    lastReadAt: now,
    lastReadMessageId: message.id,
  });

  const recipient = repositories.directMessages
    .listThreadMembers(threadId)
    .find((entry) => entry.userId !== userId);
  const sender = repositories.users.getById(userId);
  if (recipient) {
    const recipientUser = repositories.users.getById(recipient.userId);
    repositories.audit.append({
      actor: sender?.email ?? actor.email ?? actor.userId,
      action: "direct_message.sent",
      target: recipientUser?.username ?? recipient.userId,
    });
  }

  await repositories.commit();

  const response = json({
    id: message.id,
    threadId: message.threadId,
    senderUserId: message.senderUserId,
    senderUsername: sender?.username ?? "",
    senderDisplayName: sender?.displayName ?? actor.userId,
    body: message.body,
    sentAt: message.sentAt,
  } satisfies DirectMessageMessage, { status: 201 });
  recordApiMetric(env, {
    route: "dm-send",
    status: response.status,
    request,
    outcome: "sent",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function markDirectMessageThreadRead(
  request: Request,
  threadId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const repositories = await getRepositories(env);
  assertThreadMembership(repositories.directMessages.getThreadMember(threadId, userId));

  const latestMessage = repositories.directMessages.listMessagesByThread(threadId).at(-1) ?? null;
  repositories.directMessages.markThreadRead(threadId, userId, {
    lastReadAt: latestMessage?.sentAt ?? new Date().toISOString(),
    lastReadMessageId: latestMessage?.id ?? null,
  });

  await repositories.commit();

  const response = json({ ok: true });
  recordApiMetric(env, {
    route: "dm-read",
    status: response.status,
    request,
    outcome: latestMessage ? "marked" : "empty_thread",
    workspaceId: actor.workspaceId,
  });
  return response;
}

function requireAuthenticatedUserId(request: Request): string {
  if (request.headers.get("x-session-type") !== "user") {
    throw new ApiError(401, "authentication_required", "Sign in to use direct messages.");
  }

  return requireNonEmptyString(request.headers.get("x-user-id"), "authentication_required");
}

function getUsernameMatchScore(usernameNormalized: string, query: string): number {
  if (usernameNormalized === query) {
    return 3;
  }

  if (usernameNormalized.startsWith(query)) {
    return 2;
  }

  if (usernameNormalized.includes(query)) {
    return 1;
  }

  return 0;
}

function buildParticipantKey(userA: string, userB: string): string {
  return [userA, userB].sort((left, right) => left.localeCompare(right)).join(":");
}

function buildSearchResult(user: { id: string; username: string; firstName: string; lastName: string; displayName: string }): DirectMessageSearchResult {
  return {
    userId: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
  };
}

function assertThreadMembership(
  membership: { userId: string } | null,
): asserts membership is { userId: string } {
  if (!membership) {
    throw new ApiError(404, "thread_not_found", "That direct message thread was not found.");
  }
}

function buildThreadSummary(
  threadId: string,
  currentUserId: string,
  repositories: Awaited<ReturnType<typeof getRepositories>>,
): DirectMessageThreadSummary | null {
  const thread = repositories.directMessages.getThreadById(threadId);
  if (!thread) {
    return null;
  }

  const participant = getOtherParticipant(threadId, currentUserId, repositories);
  if (!participant) {
    return null;
  }

  return {
    id: thread.id,
    threadKind: "direct",
    participant,
    lastMessagePreview: thread.lastMessagePreview,
    lastMessageAt: thread.lastMessageAt,
    unreadCount: getUnreadCount(threadId, currentUserId, repositories),
    updatedAt: thread.updatedAt,
  };
}

function buildThreadDetail(
  threadId: string,
  currentUserId: string,
  repositories: Awaited<ReturnType<typeof getRepositories>>,
): DirectMessageThreadDetail | null {
  if (!repositories.directMessages.getThreadMember(threadId, currentUserId)) {
    return null;
  }

  const thread = repositories.directMessages.getThreadById(threadId);
  const participant = getOtherParticipant(threadId, currentUserId, repositories);
  if (!thread || !participant) {
    return null;
  }

  return {
    id: thread.id,
    threadKind: "direct",
    participant,
    lastMessagePreview: thread.lastMessagePreview,
    lastMessageAt: thread.lastMessageAt,
    unreadCount: getUnreadCount(threadId, currentUserId, repositories),
    updatedAt: thread.updatedAt,
    createdAt: thread.createdAt,
  };
}

function getOtherParticipant(
  threadId: string,
  currentUserId: string,
  repositories: Awaited<ReturnType<typeof getRepositories>>,
): DirectMessageSearchResult | null {
  const otherMembership = repositories.directMessages
    .listThreadMembers(threadId)
    .find((membership) => membership.userId !== currentUserId);
  if (!otherMembership) {
    return null;
  }

  const otherUser = repositories.users.getById(otherMembership.userId);
  if (!otherUser) {
    return null;
  }

  return buildSearchResult(otherUser);
}

function getUnreadCount(
  threadId: string,
  currentUserId: string,
  repositories: Awaited<ReturnType<typeof getRepositories>>,
): number {
  const membership = repositories.directMessages.getThreadMember(threadId, currentUserId);
  if (!membership) {
    return 0;
  }

  const messages = repositories.directMessages.listMessagesByThread(threadId);
  if (!messages.length) {
    return 0;
  }

  if (!membership.lastReadMessageId) {
    return messages.filter((message) => message.senderUserId !== currentUserId).length;
  }

  const lastReadIndex = messages.findIndex((message) => message.id === membership.lastReadMessageId);
  if (lastReadIndex === -1) {
    return messages.filter((message) => message.senderUserId !== currentUserId).length;
  }

  return messages
    .slice(lastReadIndex + 1)
    .filter((message) => message.senderUserId !== currentUserId).length;
}

function createMessagePreview(text: string): string {
  if (text.length <= DIRECT_MESSAGE_PREVIEW_LIMIT) {
    return text;
  }

  return `${text.slice(0, DIRECT_MESSAGE_PREVIEW_LIMIT - 1)}…`;
}
