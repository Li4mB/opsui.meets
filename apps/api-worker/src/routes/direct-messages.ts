import type {
  DirectMessageAttachment,
  DirectMessageAttachmentKind,
  DirectMessageMessage,
  DirectMessageSearchResult,
  DirectMessageThreadDetail,
  DirectMessageThreadSummary,
} from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { recordApiMetric } from "../lib/analytics";
import { getRepositories } from "../lib/data";
import {
  getDirectMessageAttachmentBlob,
  putDirectMessageAttachmentBlob,
} from "../lib/direct-message-attachment-storage";
import { ApiError, json } from "../lib/http";
import { enforceRateLimit } from "../lib/rate-limit";
import { parseJson, requireNonEmptyString } from "../lib/request";
import type { Env } from "../types";

const MAX_DIRECT_MESSAGE_LENGTH = 2_000;
const DIRECT_MESSAGE_PREVIEW_LIMIT = 120;
const SEARCH_RESULT_LIMIT = 20;
const WEBSITE_ACTIVE_WINDOW_MS = 75_000;
const MAX_DIRECT_MESSAGE_ATTACHMENTS = 10;
const MAX_DIRECT_MESSAGE_ATTACHMENT_SIZE_BYTES = 100 * 1024 * 1024;
const GENERIC_ATTACHMENT_CONTENT_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);
const IMAGE_EXTENSIONS = new Set([".apng", ".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm"]);

type Repositories = Awaited<ReturnType<typeof getRepositories>>;

interface DirectMessageAttachmentFileInput {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

interface DirectMessageAttachmentSignPayload {
  files?: unknown;
}

interface DirectMessageSendPayload {
  text?: unknown;
  attachmentIds?: unknown;
}

interface MediaUploadSignPayload {
  objectKey: string;
  contentType: string;
}

interface MediaUploadSignResponse {
  ok?: boolean;
  error?: string;
  uploadUrl?: string;
  uploadMethod?: string;
  uploadHeaders?: Record<string, string>;
}

interface MediaDownloadInfoResponse {
  ok?: boolean;
  error?: string;
  downloadUrl?: string;
}

interface DirectMessageAttachmentUploadSlot {
  attachmentId: string;
  uploadUrl: string;
  uploadMethod: "PUT";
  uploadHeaders: Record<string, string>;
}

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
    .map((message) => buildDirectMessageMessage(message, request, repositories))
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

export async function signDirectMessageAttachments(
  request: Request,
  threadId: string,
  env: Env,
): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "dm-attachments-sign",
    limit: 60,
    windowMs: 60_000,
  });

  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const repositories = await getRepositories(env);

  assertThreadMembership(repositories.directMessages.getThreadMember(threadId, userId));

  const payload = await parseJson<DirectMessageAttachmentSignPayload>(request);
  const files = parseAttachmentFiles(payload.files);
  const now = new Date().toISOString();
  const items: DirectMessageAttachmentUploadSlot[] = [];

  for (const file of files) {
    const attachmentId = crypto.randomUUID();
    const contentType = normalizeContentType(file.contentType);
    const objectKey = buildAttachmentObjectKey(threadId, attachmentId);
    const attachment = repositories.directMessages.createAttachment({
      id: attachmentId,
      threadId,
      messageId: null,
      uploaderUserId: userId,
      objectKey,
      filename: file.filename,
      contentType,
      sizeBytes: file.sizeBytes,
      kind: classifyAttachmentKind(contentType, file.filename),
      createdAt: now,
    });

    items.push(await createAttachmentUploadSlot(request, env, attachment, {
      contentType,
      objectKey,
    }));
  }

  await repositories.commit();

  const response = json({ items }, { status: 201 });
  recordApiMetric(env, {
    route: "dm-attachments-sign",
    status: response.status,
    request,
    outcome: String(items.length),
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function uploadDirectMessageAttachmentContent(
  request: Request,
  attachmentId: string,
  env: Env,
): Promise<Response> {
  enforceRateLimit(request, {
    bucket: "dm-attachment-upload",
    limit: 60,
    windowMs: 60_000,
  });

  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const repositories = await getRepositories(env);
  const attachment = repositories.directMessages.getAttachmentById(attachmentId);

  if (!attachment) {
    throw new ApiError(404, "attachment_not_found", "That attachment could not be found.");
  }

  assertThreadMembership(repositories.directMessages.getThreadMember(attachment.threadId, userId));
  if (attachment.uploaderUserId !== userId) {
    throw new ApiError(403, "attachment_not_owned", "Only your own pending attachments can be uploaded.");
  }
  if (attachment.messageId) {
    throw new ApiError(400, "attachment_already_sent", "This attachment has already been sent.");
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_DIRECT_MESSAGE_ATTACHMENT_SIZE_BYTES) {
    throw new ApiError(
      400,
      "attachment_too_large",
      `Files must be ${formatBytes(MAX_DIRECT_MESSAGE_ATTACHMENT_SIZE_BYTES)} or smaller.`,
    );
  }

  if (bytes.byteLength !== attachment.sizeBytes) {
    throw new ApiError(400, "attachment_size_mismatch", "This attachment upload did not match the expected file size.");
  }

  await putDirectMessageAttachmentBlob(env, {
    attachmentId: attachment.id,
    threadId: attachment.threadId,
    uploaderUserId: userId,
    contentType: normalizeContentType(request.headers.get("content-type") ?? attachment.contentType),
    sizeBytes: bytes.byteLength,
    bytes,
  });

  const response = json({ ok: true });
  recordApiMetric(env, {
    route: "dm-attachment-upload",
    status: response.status,
    request,
    outcome: "uploaded",
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

  const payload = await parseJson<DirectMessageSendPayload>(request);
  const text = normalizeMessageText(payload.text);
  if (text.length > MAX_DIRECT_MESSAGE_LENGTH) {
    throw new ApiError(
      400,
      "message_too_long",
      `Direct messages must be ${MAX_DIRECT_MESSAGE_LENGTH} characters or fewer.`,
    );
  }

  const attachmentIds = parseAttachmentIds(payload.attachmentIds);
  if (!text && !attachmentIds.length) {
    throw new ApiError(400, "message_content_required", "Enter a message or attach a file before sending.");
  }

  const attachments = attachmentIds.map((attachmentId) => {
    const attachment = repositories.directMessages.getAttachmentById(attachmentId);
    if (!attachment || attachment.threadId !== threadId) {
      throw new ApiError(404, "attachment_not_found", "That attachment could not be found.");
    }
    if (attachment.uploaderUserId !== userId) {
      throw new ApiError(403, "attachment_not_owned", "Only your own pending attachments can be sent.");
    }
    if (attachment.messageId) {
      throw new ApiError(400, "attachment_already_sent", "One or more files have already been attached to a message.");
    }

    return attachment;
  });

  const now = new Date().toISOString();
  const message = repositories.directMessages.createMessage({
    id: crypto.randomUUID(),
    threadId,
    senderUserId: userId,
    body: text,
    sentAt: now,
  });

  for (const attachment of attachments) {
    repositories.directMessages.updateAttachment(attachment.id, {
      messageId: message.id,
    });
  }

  repositories.directMessages.updateThread(threadId, {
    lastMessageAt: now,
    lastMessagePreview: buildMessagePreview(text, attachments),
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

  const responseBody = buildDirectMessageMessage(message, request, repositories);
  if (!responseBody) {
    throw new ApiError(500, "message_unavailable", "Your message was sent but could not be reloaded.");
  }

  const response = json(responseBody, { status: 201 });
  recordApiMetric(env, {
    route: "dm-send",
    status: response.status,
    request,
    outcome: attachments.length ? "sent_with_attachments" : "sent_text_only",
    workspaceId: actor.workspaceId,
  });
  return response;
}

export async function getDirectMessageAttachmentContent(
  request: Request,
  attachmentId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const userId = requireAuthenticatedUserId(request);
  const repositories = await getRepositories(env);
  const attachment = repositories.directMessages.getAttachmentById(attachmentId);

  if (!attachment) {
    throw new ApiError(404, "attachment_not_found", "That attachment could not be found.");
  }

  assertThreadMembership(repositories.directMessages.getThreadMember(attachment.threadId, userId));

  const url = new URL(request.url);
  const storedBlob = await getDirectMessageAttachmentBlob(env, attachment.id);
  if (storedBlob) {
    const headers = new Headers();
    headers.set("cache-control", "private, no-store");
    headers.set("content-type", storedBlob.contentType || attachment.contentType || "application/octet-stream");
    headers.set("content-length", String(storedBlob.sizeBytes));
    headers.set(
      "content-disposition",
      buildContentDisposition(url.searchParams.get("download") === "1" ? "attachment" : "inline", attachment.filename),
    );

    const responseBody = new Uint8Array(storedBlob.bytes).buffer;
    const response = new Response(
      responseBody,
      {
        status: 200,
        headers,
      },
    );
    recordApiMetric(env, {
      route: "dm-attachment-content",
      status: response.status,
      request,
      outcome: url.searchParams.get("download") === "1" ? "download" : "inline",
      workspaceId: actor.workspaceId,
    });
    return response;
  }

  const downloadUrl = await resolveMediaDownloadUrl(env, attachment.objectKey);
  const upstream = await fetch(downloadUrl);
  if (!upstream.ok || !upstream.body) {
    throw new ApiError(502, "attachment_unavailable", "This attachment is unavailable right now.");
  }

  const headers = new Headers();
  headers.set("cache-control", "private, no-store");
  headers.set(
    "content-type",
    upstream.headers.get("content-type") ?? attachment.contentType ?? "application/octet-stream",
  );
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) {
    headers.set("content-length", contentLength);
  }
  headers.set(
    "content-disposition",
    buildContentDisposition(url.searchParams.get("download") === "1" ? "attachment" : "inline", attachment.filename),
  );

  const response = new Response(upstream.body, {
    status: 200,
    headers,
  });
  recordApiMetric(env, {
    route: "dm-attachment-content",
    status: response.status,
    request,
    outcome: url.searchParams.get("download") === "1" ? "download" : "inline",
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

function buildSearchResult(user: {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  displayName: string;
  profileVisuals?: { avatar?: DirectMessageSearchResult["avatarVisual"] };
  websiteLastSeenAt?: string;
}): DirectMessageSearchResult {
  return {
    userId: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    avatarVisual: user.profileVisuals?.avatar,
    isOnline: isUserWebsiteActive(user.websiteLastSeenAt),
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
  repositories: Repositories,
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
  repositories: Repositories,
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

function buildDirectMessageMessage(
  message: {
    id: string;
    threadId: string;
    senderUserId: string;
    body: string;
    sentAt: string;
  },
  request: Request,
  repositories: Repositories,
): DirectMessageMessage | null {
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
    attachments: repositories.directMessages
      .listAttachmentsByMessage(message.id)
      .map((attachment) => buildDirectMessageAttachment(attachment, request)),
    sentAt: message.sentAt,
  };
}

function buildDirectMessageAttachment(
  attachment: {
    id: string;
    messageId: string | null;
    filename: string;
    contentType: string;
    sizeBytes: number;
    kind: DirectMessageAttachmentKind;
  },
  request: Request,
): DirectMessageAttachment {
  return {
    id: attachment.id,
    messageId: attachment.messageId ?? "",
    filename: attachment.filename,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    kind: attachment.kind,
    contentUrl: buildAbsoluteUrl(`/v1/direct-messages/attachments/${encodeURIComponent(attachment.id)}/content`, request),
    downloadUrl: buildAbsoluteUrl(
      `/v1/direct-messages/attachments/${encodeURIComponent(attachment.id)}/content?download=1`,
      request,
    ),
  };
}

function getOtherParticipant(
  threadId: string,
  currentUserId: string,
  repositories: Repositories,
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
  repositories: Repositories,
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

function isUserWebsiteActive(websiteLastSeenAt: string | undefined): boolean {
  if (!websiteLastSeenAt) {
    return false;
  }

  const lastSeenAt = Date.parse(websiteLastSeenAt);
  if (!Number.isFinite(lastSeenAt)) {
    return false;
  }

  return Date.now() - lastSeenAt <= WEBSITE_ACTIVE_WINDOW_MS;
}

function parseAttachmentFiles(value: unknown): DirectMessageAttachmentFileInput[] {
  if (!Array.isArray(value) || !value.length) {
    throw new ApiError(400, "attachments_required", "Choose at least one file before uploading.");
  }

  if (value.length > MAX_DIRECT_MESSAGE_ATTACHMENTS) {
    throw new ApiError(
      400,
      "too_many_attachments",
      `You can attach up to ${MAX_DIRECT_MESSAGE_ATTACHMENTS} files per message.`,
    );
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ApiError(400, "attachment_invalid", `Attachment ${index + 1} is invalid.`);
    }

    const filename = requireNonEmptyString(
      (entry as { filename?: unknown }).filename,
      "attachment_filename_required",
      `file-${index + 1}`,
    );
    const sizeBytes = normalizeAttachmentSize((entry as { sizeBytes?: unknown }).sizeBytes);
    if (sizeBytes > MAX_DIRECT_MESSAGE_ATTACHMENT_SIZE_BYTES) {
      throw new ApiError(
        400,
        "attachment_too_large",
        `Files must be ${formatBytes(MAX_DIRECT_MESSAGE_ATTACHMENT_SIZE_BYTES)} or smaller.`,
      );
    }

    return {
      filename,
      contentType: typeof (entry as { contentType?: unknown }).contentType === "string"
        ? (entry as { contentType: string }).contentType
        : "",
      sizeBytes,
    };
  });
}

function parseAttachmentIds(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new ApiError(400, "attachment_ids_invalid", "Attachment ids must be an array.");
  }

  if (value.length > MAX_DIRECT_MESSAGE_ATTACHMENTS) {
    throw new ApiError(
      400,
      "too_many_attachments",
      `You can attach up to ${MAX_DIRECT_MESSAGE_ATTACHMENTS} files per message.`,
    );
  }

  const ids = value.map((entry) => requireNonEmptyString(entry, "attachment_id_required"));
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    throw new ApiError(400, "attachment_ids_duplicate", "Attachment ids must be unique.");
  }

  return ids;
}

function normalizeMessageText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAttachmentSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ApiError(400, "attachment_size_invalid", "Each attachment must include a valid size.");
  }

  return Math.floor(value);
}

function normalizeContentType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized || "application/octet-stream";
}

function classifyAttachmentKind(contentType: string, filename: string): DirectMessageAttachmentKind {
  if (contentType.startsWith("image/")) {
    return "image";
  }

  if (contentType.startsWith("video/")) {
    return "video";
  }

  if (GENERIC_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
    const extension = getFilenameExtension(filename);
    if (IMAGE_EXTENSIONS.has(extension)) {
      return "image";
    }
    if (VIDEO_EXTENSIONS.has(extension)) {
      return "video";
    }
  }

  return "file";
}

function getFilenameExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return "";
  }

  return filename.slice(lastDot).toLowerCase();
}

function buildAttachmentObjectKey(threadId: string, attachmentId: string): string {
  return `direct-messages/${threadId}/${attachmentId}`;
}

function buildMessagePreview(
  text: string,
  attachments: Array<{ filename: string }>,
): string {
  if (text) {
    return createMessagePreview(text);
  }

  if (attachments.length === 1) {
    return createMessagePreview(attachments[0]?.filename ?? "Sent a file");
  }

  return `Sent ${attachments.length} files`;
}

function createMessagePreview(text: string): string {
  if (text.length <= DIRECT_MESSAGE_PREVIEW_LIMIT) {
    return text;
  }

  return `${text.slice(0, DIRECT_MESSAGE_PREVIEW_LIMIT - 1)}…`;
}

function buildAbsoluteUrl(pathname: string, request: Request): string {
  return new URL(pathname, request.url).toString();
}

async function createAttachmentUploadSlot(
  request: Request,
  env: Env,
  attachment: {
    id: string;
    threadId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    uploaderUserId: string;
  },
  payload: MediaUploadSignPayload,
): Promise<DirectMessageAttachmentUploadSlot> {
  try {
    const signedUpload = await signMediaUpload(env, payload);
    return {
      attachmentId: attachment.id,
      uploadUrl: signedUpload.uploadUrl,
      uploadMethod: signedUpload.uploadMethod,
      uploadHeaders: signedUpload.uploadHeaders,
    };
  } catch (error) {
    if (error instanceof ApiError && error.code !== "attachment_upload_sign_failed") {
      throw error;
    }
  }

  return {
    attachmentId: attachment.id,
    uploadUrl: buildAbsoluteUrl(
      `/v1/direct-messages/attachments/${encodeURIComponent(attachment.id)}/content`,
      request,
    ),
    uploadMethod: "PUT",
    uploadHeaders: {
      "content-type": attachment.contentType,
    },
  };
}

async function signMediaUpload(
  env: Env,
  payload: MediaUploadSignPayload,
): Promise<{ uploadUrl: string; uploadMethod: "PUT"; uploadHeaders: Record<string, string> }> {
  const response = await env.MEDIA_SERVICE.fetch("https://media.internal/v1/uploads/sign", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as MediaUploadSignResponse | null;
  if (
    !response.ok ||
    !body?.ok ||
    typeof body.uploadUrl !== "string" ||
    typeof body.uploadMethod !== "string" ||
    body.uploadMethod.toUpperCase() !== "PUT" ||
    !body.uploadHeaders ||
    typeof body.uploadHeaders !== "object"
  ) {
    throw new ApiError(502, "attachment_upload_sign_failed", "Uploads are unavailable right now.");
  }

  return {
    uploadUrl: body.uploadUrl,
    uploadMethod: "PUT",
    uploadHeaders: body.uploadHeaders,
  };
}

async function resolveMediaDownloadUrl(env: Env, objectKey: string): Promise<string> {
  const response = await env.MEDIA_SERVICE.fetch(
    `https://media.internal/v1/downloads/${encodeObjectKey(objectKey)}`,
  );
  const body = (await response.json().catch(() => null)) as MediaDownloadInfoResponse | null;
  if (!response.ok || !body?.ok || typeof body.downloadUrl !== "string") {
    throw new ApiError(502, "attachment_download_failed", "This attachment is unavailable right now.");
  }

  return body.downloadUrl;
}

function encodeObjectKey(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildContentDisposition(mode: "attachment" | "inline", filename: string): string {
  const safeFilename = filename
    .replace(/[\r\n"]/g, "_")
    .trim() || "download";
  return `${mode}; filename="${safeFilename}"`;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${Math.round(value / (1024 * 1024))} MB`;
  }

  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${value} B`;
}
