import { useEffect, useState } from "react";
import type { RecordingSummary } from "@opsui/shared-types";
import {
  createServerRecordingFilename,
  deleteServerRecording,
  fetchServerRecordingBlob,
  formatRecordingDuration,
  formatRecordingSize,
  isLocalScreenRecordingSupported,
  listServerRecordings,
  updateServerRecordingSaved,
} from "../lib/local-recordings";

type LoadStatus = "loading" | "ready" | "error";

export function RecordingsPage() {
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const canRecordScreen = isLocalScreenRecordingSupported();

  useEffect(() => {
    let cancelled = false;

    async function loadRecordings() {
      setLoadStatus("loading");
      setMessage(null);

      const result = await listServerRecordings();
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setLoadStatus("error");
        setMessage(result.error);
        return;
      }

      setRecordings(result.items);
      setLoadStatus("ready");
    }

    void loadRecordings();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggleSaved(recording: RecordingSummary) {
    setSavingId(recording.id);
    setMessage(null);

    const result = await updateServerRecordingSaved(recording.id, !recording.saved);
    if (!result.ok) {
      setMessage(result.error);
      setSavingId(null);
      return;
    }

    setRecordings((current) => current.map((entry) => (entry.id === recording.id ? result.recording : entry)));
    setMessage(result.recording.saved ? "Recording saved." : "Recording will delete after 30 days.");
    setSavingId(null);
  }

  async function handleDelete(recordingId: string) {
    setDeletingId(recordingId);
    setMessage(null);

    const result = await deleteServerRecording(recordingId);
    if (!result.ok) {
      setMessage(result.error);
      setDeletingId(null);
      return;
    }

    setRecordings((current) => current.filter((recording) => recording.id !== recordingId));
    setMessage("Recording deleted.");
    setDeletingId(null);
  }

  return (
    <section className="page page--recordings" aria-label="Recordings">
      <div className="recordings-page">
        <header className="recordings-page__header">
          <div>
            <div className="eyebrow">Library</div>
            <h1 className="recordings-page__title">Recordings</h1>
            <p className="recordings-page__copy">
              Screen recordings upload to OpsUI and auto-delete after 30 days unless saved.
            </p>
          </div>
        </header>

        {!canRecordScreen ? (
          <p className="inline-feedback inline-feedback--warning">
            This browser cannot start screen recordings, but uploaded recordings can still appear here.
          </p>
        ) : null}
        {message ? <p className="inline-feedback">{message}</p> : null}

        {loadStatus === "loading" ? <div className="empty-list">Loading recordings...</div> : null}
        {loadStatus === "ready" && recordings.length === 0 ? (
          <div className="recordings-empty panel-card">
            <div className="eyebrow">No Recordings</div>
            <h2 className="panel-card__title">Start recording inside a meeting.</h2>
            <p className="recordings-page__copy">
              When you stop recording, the finished video will upload and appear here.
            </p>
          </div>
        ) : null}
        {loadStatus === "ready" && recordings.length > 0 ? (
          <div className="recordings-list">
            {recordings.map((recording) => (
              <RecordingCard
                deleting={deletingId === recording.id}
                key={recording.id}
                onDelete={() => {
                  void handleDelete(recording.id);
                }}
                onToggleSaved={() => {
                  void handleToggleSaved(recording);
                }}
                recording={recording}
                saving={savingId === recording.id}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RecordingCard(props: {
  deleting: boolean;
  onDelete(): void;
  onToggleSaved(): void;
  recording: RecordingSummary;
  saving: boolean;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);
  const startedAtValue = props.recording.startedAt ?? props.recording.createdAt ?? new Date().toISOString();
  const startedAt = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(startedAtValue));
  const expiresLabel = props.recording.saved
    ? "Saved"
    : props.recording.expiresAt
      ? `Deletes ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(props.recording.expiresAt))}`
      : "Deletes after 30 days";

  useEffect(() => {
    let cancelled = false;
    let nextObjectUrl: string | null = null;

    async function loadPreview() {
      setPreviewError(false);

      try {
        const blob = await fetchServerRecordingBlob(props.recording.id);
        if (cancelled) {
          return;
        }

        nextObjectUrl = URL.createObjectURL(blob);
        setObjectUrl(nextObjectUrl);
      } catch {
        if (!cancelled) {
          setPreviewError(true);
        }
      }
    }

    void loadPreview();

    return () => {
      cancelled = true;
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl);
      }
    };
  }, [props.recording.id]);

  async function handleDownload() {
    try {
      const blob = await fetchServerRecordingBlob(props.recording.id, { download: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = createServerRecordingFilename(props.recording);
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60_000);
    } catch {}
  }

  return (
    <article className="recording-card panel-card">
      <div className="recording-card__media">
        {objectUrl ? <video controls preload="metadata" src={objectUrl} /> : null}
        {!objectUrl && !previewError ? <div className="recording-card__placeholder">Loading preview...</div> : null}
        {previewError ? <div className="recording-card__placeholder">Preview unavailable</div> : null}
        <button
          aria-label={props.recording.saved ? "Unsave recording" : "Save recording"}
          aria-pressed={Boolean(props.recording.saved)}
          className={`recording-card__save${props.recording.saved ? " is-saved" : ""}`}
          disabled={props.saving}
          onClick={props.onToggleSaved}
          title={props.recording.saved ? "Saved" : "Save"}
          type="button"
        >
          <span aria-hidden="true">{props.recording.saved ? "★" : "☆"}</span>
        </button>
      </div>
      <div className="recording-card__body">
        <div>
          <div className="eyebrow">{props.recording.provider === "browser-screen" ? "Screen" : "Meeting"}</div>
          <h2 className="recording-card__title">{props.recording.title ?? "Screen recording"}</h2>
          <p className="recording-card__meta">
            {startedAt} / {formatRecordingDuration(props.recording.durationMs ?? 0)} /{" "}
            {formatRecordingSize(props.recording.sizeBytes ?? 0)} / {expiresLabel}
          </p>
        </div>
        <div className="recording-card__actions">
          <button className="button button--secondary" onClick={handleDownload} type="button">
            Download
          </button>
          <button
            className="button button--danger"
            disabled={props.deleting}
            onClick={props.onDelete}
            type="button"
          >
            {props.deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </article>
  );
}
