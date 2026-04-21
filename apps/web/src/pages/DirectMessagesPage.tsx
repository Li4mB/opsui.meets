import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type {
  DirectMessageAttachment,
  DirectMessageAttachmentKind,
  DirectMessageMessage,
  DirectMessageSearchResult,
  DirectMessageThreadDetail,
  DirectMessageThreadSummary,
  SessionInfo,
} from "@opsui/shared-types";
import { getSessionDisplayName } from "../lib/auth";
import {
  fetchDirectMessageAttachmentBlob,
  getDirectMessageThread,
  listDirectMessageMessages,
  loadDirectMessageThreads,
  markDirectMessageThreadRead,
  openDirectMessageThread,
  searchDirectMessageUsers,
  sendDirectMessage,
  signDirectMessageAttachments,
  uploadDirectMessageAttachment,
} from "../lib/direct-messages";

const MAX_ATTACHMENTS_PER_MESSAGE = 10;

interface DirectMessagesPageProps {
  onNavigate(pathname: string): void;
  onUnreadCountChange(count: number): void;
  selectedThreadId: string | null;
  session: SessionInfo | null;
}

interface ComposerAttachmentDraft {
  id: string;
  file: File;
  kind: DirectMessageAttachmentKind;
  previewUrl: string | null;
}

export function DirectMessagesPage(props: DirectMessagesPageProps) {
  const authenticated = Boolean(props.session?.authenticated && props.session.sessionType === "user");
  const currentUserId = props.session?.actor.userId ?? "";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftAttachmentsRef = useRef<ComposerAttachmentDraft[]>([]);

  const [threads, setThreads] = useState<DirectMessageThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<DirectMessageThreadDetail | null>(null);
  const [messages, setMessages] = useState<DirectMessageMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<ComposerAttachmentDraft[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DirectMessageSearchResult[]>([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [hasLoadedThread, setHasLoadedThread] = useState(false);

  useEffect(() => {
    draftAttachmentsRef.current = draftAttachments;
  }, [draftAttachments]);

  useEffect(() => () => {
    revokeComposerAttachmentUrls(draftAttachmentsRef.current);
  }, []);

  useEffect(() => {
    setHasLoadedThread(false);
    setDraft("");
    setFeedback(null);
    revokeComposerAttachmentUrls(draftAttachmentsRef.current);
    setDraftAttachments([]);
  }, [props.selectedThreadId]);

  useEffect(() => {
    if (!authenticated) {
      revokeComposerAttachmentUrls(draftAttachmentsRef.current);
      setThreads([]);
      setSelectedThread(null);
      setMessages([]);
      setDraft("");
      setDraftAttachments([]);
      setHasLoadedThread(false);
      props.onUnreadCountChange(0);
      return;
    }

    let cancelled = false;
    let isInitialLoad = !hasLoadedThread;

    async function refreshAll() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      const nextThreads = await loadDirectMessageThreads();
      if (cancelled) {
        return;
      }

      if (nextThreads.ok) {
        setThreads(nextThreads.items);
        props.onUnreadCountChange(sumUnreadCount(nextThreads.items));
      }

      if (!props.selectedThreadId) {
        setSelectedThread(null);
        setMessages([]);
        setHasLoadedThread(false);
        isInitialLoad = true;
        return;
      }

      const isFirstLoad = isInitialLoad;
      if (isFirstLoad) {
        setIsLoadingThread(true);
      }

      const [nextThread, nextMessages] = await Promise.all([
        getDirectMessageThread(props.selectedThreadId),
        listDirectMessageMessages(props.selectedThreadId),
      ]);
      if (cancelled) {
        return;
      }

      setSelectedThread(nextThread);
      setMessages(nextMessages);
      if (isFirstLoad) {
        setIsLoadingThread(false);
        setHasLoadedThread(true);
        isInitialLoad = false;
      }
      if (!nextThread) {
        setFeedback("That conversation could not be found.");
      }
    }

    void refreshAll();

    const interval = window.setInterval(() => {
      void refreshAll();
    }, 5_000);

    function handleVisibilityOrFocus() {
      if (document.visibilityState === "visible") {
        void refreshAll();
      }
    }

    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("online", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("online", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, [authenticated, hasLoadedThread, props.onUnreadCountChange, props.selectedThreadId]);

  useEffect(() => {
    if (!authenticated) {
      setSearchResults([]);
      return;
    }

    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const results = await searchDirectMessageUsers(query);
      if (!cancelled) {
        setSearchResults(results);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [authenticated, searchQuery]);

  useEffect(() => {
    if (!authenticated || !props.selectedThreadId || !messages.length) {
      return;
    }

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    let cancelled = false;

    async function markRead() {
      const ok = await markDirectMessageThreadRead(props.selectedThreadId ?? "");
      if (!ok || cancelled) {
        return;
      }

      const nextThreads = await loadDirectMessageThreads();
      if (cancelled) {
        return;
      }

      if (nextThreads.ok) {
        setThreads(nextThreads.items);
        props.onUnreadCountChange(sumUnreadCount(nextThreads.items));
      }
      setSelectedThread((current) => (current ? { ...current, unreadCount: 0 } : current));
    }

    void markRead();
    return () => {
      cancelled = true;
    };
  }, [authenticated, messages.length, props.onUnreadCountChange, props.selectedThreadId]);

  async function handleSearchSelect(result: DirectMessageSearchResult) {
    setFeedback(null);
    const nextThread = await openDirectMessageThread(result.username);
    if (!nextThread.ok) {
      setFeedback(nextThread.message);
      return;
    }

    setSearchQuery("");
    setSearchResults([]);
    props.onNavigate(`/direct-messages/${encodeURIComponent(nextThread.thread.id)}`);
  }

  function handleComposerFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) {
      return;
    }

    if (draftAttachments.length + files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      setFeedback(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
      return;
    }

    setFeedback(null);
    setDraftAttachments((current) => [
      ...current,
      ...files.map((file) => createComposerAttachmentDraft(file)),
    ]);
  }

  function handleRemoveDraftAttachment(attachmentId: string) {
    setDraftAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== attachmentId);
      const removed = current.find((attachment) => attachment.id === attachmentId) ?? null;
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedThread || isSending) {
      return;
    }

    const text = draft.trim();
    if (!text && !draftAttachments.length) {
      setFeedback("Enter a message or attach a file before sending.");
      return;
    }

    setFeedback(null);
    setIsSending(true);

    let attachmentIds: string[] = [];
    if (draftAttachments.length) {
      const signResult = await signDirectMessageAttachments(
        selectedThread.id,
        draftAttachments.map((attachment) => attachment.file),
      );
      if (!signResult.ok) {
        setFeedback(signResult.error);
        setIsSending(false);
        return;
      }

      if (signResult.items.length !== draftAttachments.length) {
        setFeedback("Some files could not be prepared for upload.");
        setIsSending(false);
        return;
      }

      for (const [index, slot] of signResult.items.entries()) {
        const uploadResult = await uploadDirectMessageAttachment(slot, draftAttachments[index]!.file);
        if (!uploadResult.ok) {
          setFeedback(uploadResult.error);
          setIsSending(false);
          return;
        }
      }

      attachmentIds = signResult.items.map((item) => item.attachmentId);
    }

    const result = await sendDirectMessage(selectedThread.id, text, attachmentIds);
    if (!result.ok) {
      setFeedback(result.error);
      setIsSending(false);
      return;
    }

    revokeComposerAttachmentUrls(draftAttachments);
    setDraft("");
    setDraftAttachments([]);
    setMessages((current) => [...current, result.message]);
    setSelectedThread((current) =>
      current
        ? {
            ...current,
            lastMessageAt: result.message.sentAt,
            lastMessagePreview: buildThreadPreviewFromMessage(result.message),
            unreadCount: 0,
            updatedAt: result.message.sentAt,
          }
        : current,
    );

    const nextThreads = await loadDirectMessageThreads();
    if (nextThreads.ok) {
      setThreads(nextThreads.items);
      props.onUnreadCountChange(sumUnreadCount(nextThreads.items));
    }
    setIsSending(false);
  }

  if (!authenticated) {
    return (
      <section className="page page--centered page--auth">
        <div className="settings-card auth-card">
          <div className="eyebrow">Direct Messages</div>
          <h1 className="settings-card__title">Sign in to send direct messages</h1>
          <p className="settings-card__copy">
            Direct Messages are available for registered OpsUI Meets accounts only.
          </p>
          <div className="stack-actions">
            <button
              className="button button--primary"
              onClick={() => {
                props.onNavigate("/sign-in");
              }}
              type="button"
            >
              Sign In
            </button>
            <button
              className="button button--subtle"
              onClick={() => {
                props.onNavigate("/sign-up");
              }}
              type="button"
            >
              Create Account
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`page page--direct-messages${props.selectedThreadId ? " page--direct-messages-thread" : ""}`}>
      <div className="dm-layout">
        <aside className="panel-card dm-sidebar">
          <div className="panel-card__header dm-sidebar__header">
            <div>
              <div className="eyebrow">Inbox</div>
              <h1 className="panel-card__title">Direct Messages</h1>
            </div>
            <span className="status-pill">{sumUnreadCount(threads)} unread</span>
          </div>

          <label className="field">
            <span className="field__label">Search by username</span>
            <input
              className="field__input"
              onChange={(event) => {
                setSearchQuery(event.target.value);
              }}
              placeholder="@username"
              type="search"
              value={searchQuery}
            />
          </label>

          {searchQuery.trim() ? (
            <div className="dm-search-results">
              {searchResults.length ? (
                searchResults.map((result) => (
                  <button
                    className="dm-search-result"
                    key={result.userId}
                    onClick={() => {
                      void handleSearchSelect(result);
                    }}
                    type="button"
                  >
                    <strong>{result.displayName}</strong>
                    <span>@{result.username}</span>
                  </button>
                ))
              ) : (
                <p className="empty-list">No matching usernames yet.</p>
              )}
            </div>
          ) : null}

          {feedback && !props.selectedThreadId ? (
            <p className="inline-feedback inline-feedback--error">{feedback}</p>
          ) : null}

          <div className="dm-thread-list">
            {threads.length ? (
              threads.map((thread) => (
                <button
                  className={`dm-thread-list__item${thread.id === props.selectedThreadId ? " is-active" : ""}`}
                  key={thread.id}
                  onClick={() => {
                    props.onNavigate(`/direct-messages/${encodeURIComponent(thread.id)}`);
                  }}
                  type="button"
                >
                  <div className="dm-thread-list__item-main">
                    <strong>{thread.participant.displayName}</strong>
                    <span>@{thread.participant.username}</span>
                    <p>{thread.lastMessagePreview ?? "No messages yet."}</p>
                  </div>
                  <div className="dm-thread-list__item-meta">
                    <span>{formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}</span>
                    {thread.unreadCount ? <span className="status-pill status-pill--accent">{thread.unreadCount}</span> : null}
                  </div>
                </button>
              ))
            ) : (
              <p className="empty-list">
                Search for a username above to start your first direct conversation.
              </p>
            )}
          </div>
        </aside>

        <section className="panel-card panel-card--conversation dm-thread-panel">
          {props.selectedThreadId ? (
            <>
              <div className="panel-card__header dm-thread-panel__header">
                <div>
                  <div className="eyebrow">Conversation</div>
                  <h2 className="panel-card__title">
                    {selectedThread?.participant.displayName ?? "Loading conversation..."}
                  </h2>
                  {selectedThread ? <p className="people-row__meta">@{selectedThread.participant.username}</p> : null}
                </div>
                <button
                  className="button button--ghost dm-thread-panel__back"
                  onClick={() => {
                    props.onNavigate("/direct-messages");
                  }}
                  type="button"
                >
                  Back
                </button>
              </div>

              <div className="conversation-log dm-thread-panel__messages">
                {isLoadingThread ? <p className="empty-list">Loading conversation…</p> : null}
                {!isLoadingThread && !messages.length ? (
                  <p className="empty-list">
                    This conversation is ready. Send the first message whenever you are.
                  </p>
                ) : null}
                {messages.map((message) => {
                  const isSelf = message.senderUserId === currentUserId;
                  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
                  return (
                    <article className={`chat-message${isSelf ? " chat-message--self" : ""}`} key={message.id}>
                      <div className="chat-message__meta">
                        <strong>{isSelf ? "You" : message.senderDisplayName}</strong>
                        <span>{formatRelativeTime(message.sentAt)}</span>
                      </div>
                      {message.body.trim() ? <div className="chat-message__bubble">{message.body}</div> : null}
                      {attachments.length ? (
                        <div className="dm-message-attachments">
                          {attachments.map((attachment) => (
                            <DirectMessageAttachmentCard attachment={attachment} key={attachment.id} />
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <form className="conversation-composer" onSubmit={(event) => {
                void handleSendMessage(event);
              }}>
                <input
                  accept="*/*"
                  aria-label="Attach files"
                  className="dm-composer__file-input"
                  multiple
                  onChange={handleComposerFilesChange}
                  ref={fileInputRef}
                  type="file"
                />
                {draftAttachments.length ? (
                  <div className="dm-composer__attachments">
                    {draftAttachments.map((attachment) => (
                      <article className="dm-composer-attachment" key={attachment.id}>
                        <div className="dm-composer-attachment__preview">
                          {attachment.previewUrl && attachment.kind === "image" ? (
                            <img
                              alt={attachment.file.name}
                              className="dm-composer-attachment__image"
                              src={attachment.previewUrl}
                            />
                          ) : attachment.previewUrl && attachment.kind === "video" ? (
                            <video
                              className="dm-composer-attachment__video"
                              muted
                              playsInline
                              preload="metadata"
                              src={attachment.previewUrl}
                            />
                          ) : (
                            <span className="dm-composer-attachment__icon">{getAttachmentKindLabel(attachment.kind)}</span>
                          )}
                        </div>
                        <div className="dm-composer-attachment__meta">
                          <strong title={attachment.file.name}>{attachment.file.name}</strong>
                          <span>{formatAttachmentMeta(attachment)}</span>
                        </div>
                        <button
                          aria-label={`Remove ${attachment.file.name}`}
                          className="icon-button icon-button--small"
                          onClick={() => {
                            handleRemoveDraftAttachment(attachment.id);
                          }}
                          type="button"
                        >
                          ×
                        </button>
                      </article>
                    ))}
                  </div>
                ) : null}
                <div className="conversation-composer__row">
                  <button
                    aria-label="Open file picker"
                    className="conversation-send-button conversation-send-button--attach"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    type="button"
                  >
                    <PaperclipIcon />
                  </button>
                  <input
                    className="field__input conversation-composer__input"
                    onChange={(event) => {
                      setDraft(event.target.value);
                    }}
                    placeholder={`Message @${selectedThread?.participant.username ?? "user"}`}
                    value={draft}
                  />
                  <button
                    className="conversation-send-button"
                    disabled={(!draft.trim() && !draftAttachments.length) || isSending}
                    type="submit"
                  >
                    {isSending ? "…" : "↗"}
                  </button>
                </div>
                <div className="dm-composer__footer">
                  <span>{draftAttachments.length}/{MAX_ATTACHMENTS_PER_MESSAGE} files</span>
                  {feedback ? <p className="inline-feedback inline-feedback--error">{feedback}</p> : null}
                </div>
              </form>
            </>
          ) : (
            <div className="dm-thread-panel__empty">
              <div className="eyebrow">Direct Messages</div>
              <h2 className="panel-card__title">Pick a conversation</h2>
              <p className="settings-card__copy">
                Search by unique username or open any thread from your existing inbox.
              </p>
              {feedback ? <p className="inline-feedback inline-feedback--error">{feedback}</p> : null}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function DirectMessageAttachmentCard(props: { attachment: DirectMessageAttachment }) {
  const isInlineMedia = props.attachment.kind === "image" || props.attachment.kind === "video";
  const isBlobUrl = props.attachment.contentUrl.startsWith("blob:");
  const [previewUrl, setPreviewUrl] = useState<string | null>(isBlobUrl ? props.attachment.contentUrl : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(Boolean(isInlineMedia && !isBlobUrl));
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!isInlineMedia || isBlobUrl) {
      setPreviewUrl(props.attachment.contentUrl);
      setIsLoadingPreview(false);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    let nextPreviewUrl: string | null = null;

    async function loadPreview() {
      setIsLoadingPreview(true);
      setLoadError(null);
      try {
        const blob = await fetchDirectMessageAttachmentBlob(props.attachment.id);
        if (cancelled) {
          return;
        }

        nextPreviewUrl = URL.createObjectURL(blob);
        setPreviewUrl(nextPreviewUrl);
      } catch {
        if (!cancelled) {
          setLoadError("Preview unavailable.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPreview(false);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
      if (nextPreviewUrl) {
        URL.revokeObjectURL(nextPreviewUrl);
      }
    };
  }, [isBlobUrl, isInlineMedia, props.attachment.contentUrl, props.attachment.id]);

  async function handleOpen() {
    setIsBusy(true);
    try {
      if (props.attachment.contentUrl.startsWith("blob:")) {
        openObjectUrl(props.attachment.contentUrl);
        return;
      }

      const blob = await fetchDirectMessageAttachmentBlob(props.attachment.id);
      const objectUrl = URL.createObjectURL(blob);
      openObjectUrl(objectUrl, true);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDownload() {
    setIsBusy(true);
    try {
      if (props.attachment.downloadUrl.startsWith("blob:")) {
        downloadObjectUrl(props.attachment.downloadUrl, props.attachment.filename);
        return;
      }

      const blob = await fetchDirectMessageAttachmentBlob(props.attachment.id, { download: true });
      const objectUrl = URL.createObjectURL(blob);
      downloadObjectUrl(objectUrl, props.attachment.filename, true);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <article className={`dm-attachment-card dm-attachment-card--${props.attachment.kind}`}>
      {isInlineMedia && previewUrl && !loadError ? (
        <div className="dm-attachment-card__preview-shell">
          {props.attachment.kind === "image" ? (
            <img
              alt={props.attachment.filename}
              className="dm-attachment-card__image"
              src={previewUrl}
            />
          ) : (
            <video
              className="dm-attachment-card__video"
              controls
              playsInline
              preload="metadata"
              src={previewUrl}
            />
          )}
        </div>
      ) : isInlineMedia && isLoadingPreview ? (
        <div className="dm-attachment-card__placeholder">Loading preview…</div>
      ) : null}
      <div className="dm-attachment-card__body">
        <div className="dm-attachment-card__meta">
          <strong title={props.attachment.filename}>{props.attachment.filename}</strong>
          <span>{formatExistingAttachmentMeta(props.attachment)}</span>
          {loadError ? <span>{loadError}</span> : null}
        </div>
        <div className="dm-attachment-card__actions">
          <button
            className="button button--ghost"
            disabled={isBusy}
            onClick={() => {
              void handleOpen();
            }}
            type="button"
          >
            Open
          </button>
          <button
            className="button button--ghost"
            disabled={isBusy}
            onClick={() => {
              void handleDownload();
            }}
            type="button"
          >
            Download
          </button>
        </div>
      </div>
    </article>
  );
}

function sumUnreadCount(threads: DirectMessageThreadSummary[]) {
  return threads.reduce((total, thread) => total + thread.unreadCount, 0);
}

function createComposerAttachmentDraft(file: File): ComposerAttachmentDraft {
  const kind = classifyDraftAttachmentKind(file);
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    file,
    kind,
    previewUrl: kind === "image" || kind === "video" ? URL.createObjectURL(file) : null,
  };
}

function revokeComposerAttachmentUrls(attachments: ComposerAttachmentDraft[]) {
  for (const attachment of attachments) {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

function classifyDraftAttachmentKind(file: File): DirectMessageAttachmentKind {
  const type = file.type.trim().toLowerCase();
  if (type.startsWith("image/")) {
    return "image";
  }
  if (type.startsWith("video/")) {
    return "video";
  }

  const extension = getFileExtension(file.name);
  if ([".apng", ".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(extension)) {
    return "image";
  }
  if ([".m4v", ".mov", ".mp4", ".mpeg", ".mpg", ".ogv", ".webm"].includes(extension)) {
    return "video";
  }

  return "file";
}

function getFileExtension(filename: string): string {
  const index = filename.lastIndexOf(".");
  if (index <= 0 || index === filename.length - 1) {
    return "";
  }

  return filename.slice(index).toLowerCase();
}

function buildThreadPreviewFromMessage(message: DirectMessageMessage): string {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (message.body.trim()) {
    return truncatePreview(message.body.trim());
  }

  if (attachments.length === 1) {
    return truncatePreview(attachments[0]?.filename ?? "Sent a file");
  }

  return `Sent ${attachments.length} files`;
}

function truncatePreview(value: string) {
  return value.length <= 120 ? value : `${value.slice(0, 119)}…`;
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "";
  }

  const diffMs = timestamp - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) {
    return formatter.format(diffDays, "day");
  }

  return new Date(timestamp).toLocaleDateString();
}

function formatBytes(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${value} B`;
}

function getAttachmentKindLabel(kind: DirectMessageAttachmentKind) {
  if (kind === "image") {
    return "IMG";
  }
  if (kind === "video") {
    return "VID";
  }
  return "FILE";
}

function formatAttachmentMeta(attachment: ComposerAttachmentDraft) {
  return `${getAttachmentKindLabel(attachment.kind)} · ${formatBytes(attachment.file.size)}`;
}

function formatExistingAttachmentMeta(attachment: DirectMessageAttachment) {
  return `${getAttachmentKindLabel(attachment.kind)} · ${formatBytes(attachment.sizeBytes)}`;
}

function openObjectUrl(url: string, revokeLater = false) {
  window.open(url, "_blank", "noopener,noreferrer");
  if (revokeLater) {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
  }
}

function downloadObjectUrl(url: string, filename: string, revokeLater = false) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();

  if (revokeLater) {
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60_000);
  }
}

function PaperclipIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.9"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M21.4 11.1 12 20.5a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 1 1 5.6 5.7l-9.8 9.8a2 2 0 1 1-2.8-2.8l8.7-8.7" />
    </svg>
  );
}
