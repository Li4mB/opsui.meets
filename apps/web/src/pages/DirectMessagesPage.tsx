import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type FormEvent } from "react";
import type {
  DirectMessageAttachment,
  DirectMessageAttachmentKind,
  DirectMessageMessage,
  ProfileVisualAsset,
  DirectMessageSearchResult,
  DirectMessageThreadDetail,
  DirectMessageThreadSummary,
  SessionInfo,
} from "@opsui/shared-types";
import {
  createDirectMessageGroupThread,
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [threads, setThreads] = useState<DirectMessageThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<DirectMessageThreadDetail | null>(null);
  const [messages, setMessages] = useState<DirectMessageMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<ComposerAttachmentDraft[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DirectMessageSearchResult[]>([]);
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [groupSearchResults, setGroupSearchResults] = useState<DirectMessageSearchResult[]>([]);
  const [groupSelectedMembers, setGroupSelectedMembers] = useState<DirectMessageSearchResult[]>([]);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
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
    if (!authenticated || !groupCreatorOpen) {
      setGroupSearchResults([]);
      return;
    }

    const query = groupSearchQuery.trim();
    if (!query) {
      setGroupSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      const results = await searchDirectMessageUsers(query);
      if (!cancelled) {
        setGroupSearchResults(results);
      }
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [authenticated, groupCreatorOpen, groupSearchQuery]);

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

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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

  function handleToggleGroupCreator() {
    setFeedback(null);
    setGroupCreatorOpen((current) => !current);
    setGroupSearchQuery("");
    setGroupSearchResults([]);
  }

  function handleToggleGroupMember(result: DirectMessageSearchResult) {
    setFeedback(null);
    setGroupSelectedMembers((current) => {
      if (current.some((member) => member.userId === result.userId)) {
        return current.filter((member) => member.userId !== result.userId);
      }

      return [...current, result];
    });
  }

  async function handleCreateGroupThread() {
    if (isCreatingGroup) {
      return;
    }

    if (groupSelectedMembers.length < 2) {
      setFeedback("Choose at least two people for a group chat.");
      return;
    }

    setFeedback(null);
    setIsCreatingGroup(true);
    const result = await createDirectMessageGroupThread(
      groupSelectedMembers.map((member) => member.userId),
    );
    setIsCreatingGroup(false);

    if (!result.ok) {
      setFeedback(result.message);
      return;
    }

    const nextThreads = await loadDirectMessageThreads();
    if (nextThreads.ok) {
      setThreads(nextThreads.items);
      props.onUnreadCountChange(sumUnreadCount(nextThreads.items));
    }

    setGroupCreatorOpen(false);
    setGroupSearchQuery("");
    setGroupSearchResults([]);
    setGroupSelectedMembers([]);
    props.onNavigate(`/direct-messages/${encodeURIComponent(result.thread.id)}`);
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

  const unreadTotal = sumUnreadCount(threads);
  const groupCandidates = buildGroupCandidates({
    query: groupSearchQuery,
    results: groupSearchResults,
    selected: groupSelectedMembers,
    threads,
  });

  return (
    <section className={`page page--direct-messages${props.selectedThreadId ? " page--direct-messages-thread" : ""}`} style={{ padding: 0 }}>
      <div className="dm-layout">
        {/* ── Left Sidebar ────────────────────────── */}
        <aside className="dm-sidebar">
          <div className="dm-sidebar__header">
            <div>
              <p className="dm-eyebrow">Inbox</p>
              <div className="dm-title-row">
                <button
                  aria-label="Create group chat"
                  aria-pressed={groupCreatorOpen}
                  className="dm-create-group-btn"
                  onClick={handleToggleGroupCreator}
                  title="Create group chat"
                  type="button"
                >
                  <PersonPlusIcon />
                </button>
                <h1 className="dm-title">Direct Messages</h1>
              </div>
            </div>
            {unreadTotal > 0 ? (
              <span className="dm-unread-badge">{unreadTotal} unread</span>
            ) : null}
          </div>

          {groupCreatorOpen ? (
            <div className="dm-group-creator">
              {groupSelectedMembers.length ? (
                <div className="dm-group-creator__selected" aria-label="Selected group members">
                  {groupSelectedMembers.map((member) => (
                    <button
                      className="dm-group-chip"
                      key={member.userId}
                      onClick={() => {
                        handleToggleGroupMember(member);
                      }}
                      type="button"
                    >
                      <span>{member.displayName}</span>
                      x
                    </button>
                  ))}
                </div>
              ) : (
                <p className="dm-group-creator__hint">Choose at least two people.</p>
              )}

              <div className="dm-search dm-group-search">
                <span className="dm-search__icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
                <input
                  aria-label="Search people for group chat"
                  className="dm-search__input"
                  onChange={(event) => {
                    setGroupSearchQuery(event.target.value);
                  }}
                  placeholder="Add people..."
                  type="search"
                  value={groupSearchQuery}
                />
              </div>

              <div className="dm-group-candidates">
                {groupCandidates.length ? (
                  groupCandidates.map((result) => {
                    const selected = groupSelectedMembers.some((member) => member.userId === result.userId);
                    return (
                      <button
                        className={`dm-group-candidate${selected ? " is-selected" : ""}`}
                        key={result.userId}
                        onClick={() => {
                          handleToggleGroupMember(result);
                        }}
                        type="button"
                      >
                        <DirectMessageAvatar
                          displayName={result.displayName}
                          isOnline={result.isOnline}
                          size="md"
                          visual={result.avatarVisual}
                        />
                        <div className="dm-search-result__info">
                          <span className="dm-search-result__name">{result.displayName}</span>
                          <span className="dm-search-result__username">@{result.username}</span>
                        </div>
                        <span className="dm-group-candidate__check">{selected ? "Selected" : "Add"}</span>
                      </button>
                    );
                  })
                ) : (
                  <p className="dm-group-creator__empty">
                    {groupSearchQuery.trim() ? "No matching usernames." : "Existing chats appear here first."}
                  </p>
                )}
              </div>

              <div className="dm-group-creator__actions">
                <button
                  className="button button--subtle"
                  onClick={() => {
                    setGroupCreatorOpen(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="button button--primary"
                  disabled={groupSelectedMembers.length < 2 || isCreatingGroup}
                  onClick={() => {
                    void handleCreateGroupThread();
                  }}
                  type="button"
                >
                  Create
                </button>
              </div>
            </div>
          ) : null}

          {/* Search */}
          <div className="dm-search">
            <span className="dm-search__icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              className="dm-search__input"
              onChange={(event) => {
                setSearchQuery(event.target.value);
              }}
              placeholder="Search by username..."
              type="search"
              value={searchQuery}
            />
          </div>

          {/* Search Results */}
          {searchQuery.trim() ? (
            <div className="dm-search-results" style={{ paddingBottom: 8 }}>
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
                    <DirectMessageAvatar
                      displayName={result.displayName}
                      isOnline={result.isOnline}
                      size="md"
                      visual={result.avatarVisual}
                    />
                    <div className="dm-search-result__info">
                      <span className="dm-search-result__name">{result.displayName}</span>
                      <span className="dm-search-result__username">@{result.username}</span>
                    </div>
                  </button>
                ))
              ) : (
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", padding: "8px 4px", margin: 0 }}>
                  No matching usernames.
                </p>
              )}
            </div>
          ) : null}

          {feedback && !props.selectedThreadId ? (
            <p className="inline-feedback inline-feedback--error" style={{ fontSize: 12, padding: "0 16px", margin: 0 }}>
              {feedback}
            </p>
          ) : null}

          {/* Thread List */}
          <div className="dm-thread-list custom-scrollbar">
            {threads.length ? (
              threads.map((thread) => (
                <button
                  className={`dm-thread-item${thread.id === props.selectedThreadId ? " is-active" : ""}`}
                  key={thread.id}
                  onClick={() => {
                    props.onNavigate(`/direct-messages/${encodeURIComponent(thread.id)}`);
                  }}
                  type="button"
                >
                  <ThreadAvatar thread={thread} size="md" />
                  <div className="dm-thread-item__info">
                    <div className="dm-thread-item__top">
                      <span className="dm-thread-item__name">{getThreadDisplayName(thread)}</span>
                      <span className="dm-thread-item__time">
                        {formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}
                      </span>
                    </div>
                    <div className="dm-thread-item__bottom">
                      <span className="dm-thread-item__preview">
                        {thread.lastMessagePreview ?? "No messages yet."}
                      </span>
                      {thread.unreadCount ? (
                        <span className="dm-thread-item__unread">{thread.unreadCount}</span>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", padding: "16px 8px", margin: 0, textAlign: "center" }}>
                Search for a username to start your first conversation.
              </p>
            )}
          </div>
        </aside>

        {/* ── Right Panel — Conversation ─────────── */}
        <section className="dm-conversation">
          {props.selectedThreadId ? (
            <>
              {/* Conversation Header */}
              <div className="dm-conversation__header">
                <div className="dm-conversation__user">
                  {selectedThread ? (
                    <ThreadAvatar thread={selectedThread} size="lg" />
                  ) : (
                    <DirectMessageAvatar displayName="" size="lg" />
                  )}
                  <div className="dm-conversation__user-info">
                    <p className="dm-conversation__eyebrow">Conversation</p>
                    <div className="dm-conversation__name">
                      {selectedThread ? getThreadDisplayName(selectedThread) : "Loading..."}
                    </div>
                    {selectedThread ? (
                      <div className="dm-conversation__username">
                        {getThreadSubtitle(selectedThread)}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="dm-conversation__actions">
                    {/* Phone button — visual only */}
                    <button className="dm-action-btn" type="button">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                    </button>
                    {/* Video button — visual only */}
                    <button className="dm-action-btn" type="button">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    </button>
                    {/* More button — visual only */}
                    <button className="dm-action-btn" type="button">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="1.5" />
                        <circle cx="12" cy="12" r="1.5" />
                        <circle cx="12" cy="19" r="1.5" />
                      </svg>
                    </button>
                  </div>
                  <button
                    className="dm-back-btn dm-thread-panel__back"
                    onClick={() => {
                      props.onNavigate("/direct-messages");
                    }}
                    type="button"
                  >
                    ← Back
                  </button>
                </div>
              </div>

              {/* Messages Area */}
              <div className="dm-conversation__messages custom-scrollbar">
                {isLoadingThread ? (
                  <p style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", textAlign: "center", margin: 0 }}>
                    Loading conversation…
                  </p>
                ) : null}
                {!isLoadingThread && !messages.length ? (
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", textAlign: "center", margin: "auto 0", lineHeight: 1.6 }}>
                    This conversation is ready. Send the first message whenever you are.
                  </p>
                ) : null}
                {renderMessageGroups(messages, currentUserId)}
                <div ref={messagesEndRef} />
              </div>

              {/* Message Composer */}
              <form
                className="dm-composer"
                onSubmit={(event) => {
                  void handleSendMessage(event);
                }}
              >
                <input
                  accept="*/*"
                  aria-label="Attach files"
                  className="dm-composer__file-input"
                  multiple
                  onChange={handleComposerFilesChange}
                  ref={fileInputRef}
                  type="file"
                />
                <div className="dm-composer__shell">
                  {draftAttachments.length ? (
                    <div className="dm-composer__drafts">
                      {draftAttachments.map((attachment) => (
                        <div key={attachment.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                            {attachment.file.name}
                          </span>
                          <button
                            aria-label={`Remove ${attachment.file.name}`}
                            onClick={() => {
                              handleRemoveDraftAttachment(attachment.id);
                            }}
                            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 14, padding: "0 4px", font: "inherit" }}
                            type="button"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="dm-composer__row">
                    <button
                      aria-label="Open file picker"
                      className="dm-composer__attach-btn"
                      onClick={() => {
                        fileInputRef.current?.click();
                      }}
                      type="button"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.4 11.1 12 20.5a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 1 1 5.6 5.7l-9.8 9.8a2 2 0 1 1-2.8-2.8l8.7-8.7" />
                      </svg>
                    </button>
                    <input
                      className="dm-composer__text-input"
                      onChange={(event) => {
                        setDraft(event.target.value);
                      }}
                      placeholder={getComposerPlaceholder(selectedThread)}
                      value={draft}
                    />
                    <span className="dm-composer__counter">
                      {draftAttachments.length}/{MAX_ATTACHMENTS_PER_MESSAGE}
                    </span>
                    <button
                      className="dm-composer__send-btn"
                      disabled={(!draft.trim() && !draftAttachments.length) || isSending}
                      type="submit"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                    </button>
                  </div>
                </div>
              </form>
              {feedback ? (
                <div className="dm-composer__footer">
                  <p className="inline-feedback inline-feedback--error" style={{ margin: 0, fontSize: 11 }}>
                    {feedback}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            /* Empty State */
            <div className="dm-conversation__empty">
              <p className="dm-eyebrow">Direct Messages</p>
              <h2 className="dm-conversation__empty-title">Pick a conversation</h2>
              <p className="dm-conversation__empty-copy">
                Search by unique username or open any thread from your existing inbox.
              </p>
              {feedback ? (
                <p className="inline-feedback inline-feedback--error" style={{ margin: 0, fontSize: 12 }}>
                  {feedback}
                </p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

/* ── Message Group Rendering ─────────────────────── */

function renderMessageGroups(messages: DirectMessageMessage[], currentUserId: string) {
  const groups: Array<{ date: string; messages: DirectMessageMessage[] }> = [];
  let currentDate = "";

  for (const message of messages) {
    const date = formatDate(message.sentAt);
    if (date !== currentDate) {
      currentDate = date;
      groups.push({ date, messages: [message] });
    } else {
      groups[groups.length - 1]!.messages.push(message);
    }
  }

  return groups.map((group, gi) => (
    <div key={gi}>
      <div className="dm-date-separator">
        <div className="dm-date-separator__line" />
        <span className="dm-date-separator__text">{group.date}</span>
        <div className="dm-date-separator__line" />
      </div>
      {group.messages.map((message) => {
        const isSelf = message.senderUserId === currentUserId;
        const attachments = Array.isArray(message.attachments) ? message.attachments : [];
        return (
          <div className={`dm-message${isSelf ? " dm-message--sent" : " dm-message--received"}`} key={message.id}>
            <div className="dm-message__content">
              <div className="dm-message__meta">
                <span className="dm-message__sender">{isSelf ? "You" : message.senderDisplayName}</span>
                <span className="dm-message__time">{formatRelativeTime(message.sentAt)}</span>
              </div>
              {message.body.trim() ? (
                <div className="dm-message__bubble">{message.body}</div>
              ) : null}
              {attachments.length ? (
                <div className="dm-message-attachments" style={{ marginTop: message.body.trim() ? 4 : 0 }}>
                  {attachments.map((attachment) => (
                    <DirectMessageAttachmentCard attachment={attachment} key={attachment.id} />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  ));
}

/* ── Attachment Card Component ───────────────────── */

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

  // Image attachment card
  if (isInlineMedia && props.attachment.kind === "image") {
    return (
      <article className="dm-message-image">
        {previewUrl && !loadError ? (
          <div className="dm-message-image__preview">
            <img
              alt={props.attachment.filename}
              className="dm-attachment-card__image"
              src={previewUrl}
            />
          </div>
        ) : isLoadingPreview ? (
          <div className="dm-message-image__preview" style={{ display: "grid", placeItems: "center" }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>Loading…</span>
          </div>
        ) : null}
        <div className="dm-message-image__info dm-attachment-card__meta">
          <div className="dm-message-image__filename">{props.attachment.filename}</div>
          <span className="dm-message-image__size">{formatBytes(props.attachment.sizeBytes)}</span>
          {loadError ? <span className="dm-message-image__size">{loadError}</span> : null}
        </div>
        <div className="dm-message-image__actions">
          <button
            className="dm-image-action"
            disabled={isBusy}
            onClick={() => {
              void handleOpen();
            }}
            type="button"
          >
            Open
          </button>
          <button
            className="dm-image-action"
            disabled={isBusy}
            onClick={() => {
              void handleDownload();
            }}
            type="button"
          >
            Download
          </button>
        </div>
      </article>
    );
  }

  // Non-image attachment card
  return (
    <article className="dm-attachment-card">
      {isInlineMedia && previewUrl && !loadError ? (
        <div className="dm-attachment-card__preview-shell">
          <video
            className="dm-attachment-card__video"
            controls
            playsInline
            preload="metadata"
            src={previewUrl}
          />
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
            className="dm-image-action"
            disabled={isBusy}
            onClick={() => {
              void handleOpen();
            }}
            type="button"
          >
            Open
          </button>
          <button
            className="dm-image-action"
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

/* ── Helper Functions ────────────────────────────── */

function PersonPlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6" />
      <path d="M22 11h-6" />
    </svg>
  );
}

function ThreadAvatar(props: {
  thread: DirectMessageThreadSummary | DirectMessageThreadDetail;
  size: "md" | "lg";
}) {
  if (props.thread.threadKind === "group") {
    return <DirectMessageGroupAvatar size={props.size} />;
  }

  return (
    <DirectMessageAvatar
      displayName={props.thread.participant.displayName}
      isOnline={props.thread.participant.isOnline}
      size={props.size}
      visual={props.thread.participant.avatarVisual}
    />
  );
}

function DirectMessageGroupAvatar(props: { size: "md" | "lg" }) {
  return (
    <div className={`dm-avatar dm-avatar--${props.size}`}>
      <div className="dm-avatar__surface dm-avatar__surface--group">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
    </div>
  );
}

function getThreadDisplayName(thread: DirectMessageThreadSummary | DirectMessageThreadDetail): string {
  return thread.threadKind === "group" ? thread.group.displayName : thread.participant.displayName;
}

function getThreadSubtitle(thread: DirectMessageThreadSummary | DirectMessageThreadDetail): string {
  return thread.threadKind === "group" ? `${thread.group.memberCount} members` : `@${thread.participant.username}`;
}

function getComposerPlaceholder(thread: DirectMessageThreadDetail | null): string {
  if (!thread) {
    return "Message user...";
  }

  return thread.threadKind === "group" ? "Message group..." : `Message @${thread.participant.username}...`;
}

function buildGroupCandidates(input: {
  query: string;
  results: DirectMessageSearchResult[];
  selected: DirectMessageSearchResult[];
  threads: DirectMessageThreadSummary[];
}): DirectMessageSearchResult[] {
  const existing = input.threads
    .filter((thread): thread is Extract<DirectMessageThreadSummary, { threadKind: "direct" }> =>
      thread.threadKind === "direct",
    )
    .map((thread) => thread.participant);
  const existingIds = new Set(existing.map((member) => member.userId));
  const source = input.query.trim() ? input.results : existing;
  const merged = [...input.selected, ...source];
  const unique = new Map<string, DirectMessageSearchResult>();

  for (const member of merged) {
    unique.set(member.userId, member);
  }

  return [...unique.values()].sort((left, right) => {
    const leftExisting = existingIds.has(left.userId);
    const rightExisting = existingIds.has(right.userId);
    if (leftExisting !== rightExisting) {
      return leftExisting ? -1 : 1;
    }

    return left.displayName.localeCompare(right.displayName);
  });
}

function DirectMessageAvatar(props: {
  displayName: string;
  isOnline?: boolean;
  size: "md" | "lg";
  visual?: ProfileVisualAsset;
}) {
  const initials = getInitials(props.displayName);
  const visual = props.visual;
  const showImage = visual?.mode === "image" && Boolean(visual.imageDataUrl);

  return (
    <div className={`dm-avatar dm-avatar--${props.size}`}>
      <div
        className={`dm-avatar__surface${showImage ? " dm-avatar__surface--image" : ""}`}
        style={{ "--dm-avatar-color": visual?.color ?? "#4A5568" } as CSSProperties}
      >
        {showImage ? (
          <img
            alt=""
            src={visual?.imageDataUrl}
            style={{ transform: `scale(${getAvatarVisualScale(visual)})` }}
          />
        ) : (
          initials
        )}
      </div>
      {props.isOnline ? <div className="dm-avatar__online" /> : null}
    </div>
  );
}

function getInitials(displayName: string): string {
  if (!displayName) return "?";
  const parts = displayName.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

function getAvatarVisualScale(visual: ProfileVisualAsset | undefined): number {
  if (!visual) {
    return 1;
  }

  return 1 + (Math.min(100, Math.max(0, visual.zoom)) / 100) * 1.5;
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

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "";
  }

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "Today";
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
