import { useEffect, useState, type FormEvent } from "react";
import type {
  DirectMessageMessage,
  DirectMessageSearchResult,
  DirectMessageThreadDetail,
  DirectMessageThreadSummary,
  SessionInfo,
} from "@opsui/shared-types";
import { getSessionDisplayName } from "../lib/auth";
import {
  getDirectMessageThread,
  listDirectMessageMessages,
  listDirectMessageThreads,
  markDirectMessageThreadRead,
  openDirectMessageThread,
  searchDirectMessageUsers,
  sendDirectMessage,
} from "../lib/direct-messages";

interface DirectMessagesPageProps {
  onNavigate(pathname: string): void;
  onUnreadCountChange(count: number): void;
  selectedThreadId: string | null;
  session: SessionInfo | null;
}

export function DirectMessagesPage(props: DirectMessagesPageProps) {
  const authenticated = Boolean(props.session?.authenticated && props.session.sessionType === "user");
  const currentUserId = props.session?.actor.userId ?? "";
  const currentUsername = props.session?.actor.username ?? "you";
  const currentDisplayName = getSessionDisplayName(props.session);

  const [threads, setThreads] = useState<DirectMessageThreadSummary[]>([]);
  const [selectedThread, setSelectedThread] = useState<DirectMessageThreadDetail | null>(null);
  const [messages, setMessages] = useState<DirectMessageMessage[]>([]);
  const [pendingMessages, setPendingMessages] = useState<DirectMessageMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DirectMessageSearchResult[]>([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [hasLoadedThread, setHasLoadedThread] = useState(false);

  useEffect(() => {
    setHasLoadedThread(false);
  }, [props.selectedThreadId]);

  useEffect(() => {
    if (!authenticated) {
      setThreads([]);
      setSelectedThread(null);
      setMessages([]);
      setPendingMessages([]);
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

      const nextThreads = await listDirectMessageThreads();
      if (cancelled) {
        return;
      }

      setThreads(nextThreads);
      props.onUnreadCountChange(sumUnreadCount(nextThreads));

      if (!props.selectedThreadId) {
        setSelectedThread(null);
        setMessages([]);
        setPendingMessages([]);
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
        setPendingMessages([]);
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
  }, [authenticated, props.selectedThreadId, props.onUnreadCountChange]);

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

      const nextThreads = await listDirectMessageThreads();
      if (cancelled) {
        return;
      }

      setThreads(nextThreads);
      props.onUnreadCountChange(sumUnreadCount(nextThreads));
      setSelectedThread((current) => (current ? { ...current, unreadCount: 0 } : current));
    }

    void markRead();
    return () => {
      cancelled = true;
    };
  }, [authenticated, messages.length, props.onUnreadCountChange, props.selectedThreadId]);

  const combinedMessages = [...messages, ...pendingMessages].sort(
    (left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt),
  );

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

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedThread || !draft.trim() || isSending) {
      return;
    }

    const optimisticBody = draft.trim();
    const optimisticMessage: DirectMessageMessage = {
      id: `pending-${Date.now()}`,
      threadId: selectedThread.id,
      senderUserId: currentUserId,
      senderUsername: currentUsername,
      senderDisplayName: currentDisplayName,
      body: optimisticBody,
      sentAt: new Date().toISOString(),
    };

    setDraft("");
    setFeedback(null);
    setIsSending(true);
    setPendingMessages((current) => [...current, optimisticMessage]);

    const result = await sendDirectMessage(selectedThread.id, optimisticBody);
    if (!result.ok) {
      setPendingMessages((current) => current.filter((message) => message.id !== optimisticMessage.id));
      setDraft(optimisticBody);
      setFeedback(result.error);
      setIsSending(false);
      return;
    }

    setPendingMessages((current) => current.filter((message) => message.id !== optimisticMessage.id));
    setMessages((current) => [...current, result.message]);
    setSelectedThread((current) =>
      current
        ? {
            ...current,
            lastMessageAt: result.message.sentAt,
            lastMessagePreview: result.message.body,
            unreadCount: 0,
            updatedAt: result.message.sentAt,
          }
        : current,
    );

    const nextThreads = await listDirectMessageThreads();
    setThreads(nextThreads);
    props.onUnreadCountChange(sumUnreadCount(nextThreads));
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
                {!isLoadingThread && !combinedMessages.length ? (
                  <p className="empty-list">
                    This conversation is ready. Send the first message whenever you are.
                  </p>
                ) : null}
                {combinedMessages.map((message) => {
                  const isSelf = message.senderUserId === currentUserId;
                  return (
                    <article className={`chat-message${isSelf ? " chat-message--self" : ""}`} key={message.id}>
                      <div className="chat-message__meta">
                        <strong>{isSelf ? "You" : message.senderDisplayName}</strong>
                        <span>{formatRelativeTime(message.sentAt)}</span>
                      </div>
                      <div className="chat-message__bubble">{message.body}</div>
                    </article>
                  );
                })}
              </div>

              <form className="conversation-composer" onSubmit={(event) => {
                void handleSendMessage(event);
              }}>
                <div className="conversation-composer__row">
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
                    disabled={!draft.trim() || isSending}
                    type="submit"
                  >
                    ↗
                  </button>
                </div>
                {feedback ? <p className="inline-feedback inline-feedback--error">{feedback}</p> : null}
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

function sumUnreadCount(threads: DirectMessageThreadSummary[]) {
  return threads.reduce((total, thread) => total + thread.unreadCount, 0);
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
