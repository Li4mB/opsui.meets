import type { RecordingSummary } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class RecordingsRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  upsert(recording: RecordingSummary): RecordingSummary {
    const store = this.getStore();
    const index = store.recordings.findIndex((item) => item.id === recording.id);
    if (index >= 0) {
      store.recordings[index] = recording;
    } else {
      store.recordings.unshift(recording);
    }

    const summary = store.meetingSummaries.find(
      (item) => item.meetingInstanceId === recording.meetingInstanceId,
    );
    if (summary) {
      summary.recordingStatus = recording.status;
    }

    return recording;
  }

  getByMeetingInstanceId(meetingInstanceId: string): RecordingSummary | null {
    return (
      this.getStore().recordings.find(
        (recording) => recording.meetingInstanceId === meetingInstanceId,
      ) ?? null
    );
  }

  getById(recordingId: string): RecordingSummary | null {
    return this.getStore().recordings.find((recording) => recording.id === recordingId) ?? null;
  }

  listByOwnerUserId(ownerUserId: string): RecordingSummary[] {
    return this.getStore().recordings
      .filter((recording) => recording.ownerUserId === ownerUserId)
      .sort((left, right) => {
        const leftAt = Date.parse(left.startedAt ?? left.createdAt ?? left.stoppedAt ?? "");
        const rightAt = Date.parse(right.startedAt ?? right.createdAt ?? right.stoppedAt ?? "");
        return safeTimestamp(rightAt) - safeTimestamp(leftAt);
      });
  }

  updateSaved(recordingId: string, ownerUserId: string, saved: boolean): RecordingSummary | null {
    const recording = this.getStore().recordings.find(
      (entry) => entry.id === recordingId && entry.ownerUserId === ownerUserId,
    ) ?? null;
    if (!recording) {
      return null;
    }

    recording.saved = saved;
    recording.expiresAt = saved ? null : getDefaultRecordingExpiryIso();
    return recording;
  }

  deleteById(recordingId: string, ownerUserId?: string): RecordingSummary | null {
    const store = this.getStore();
    const index = store.recordings.findIndex(
      (recording) => recording.id === recordingId && (!ownerUserId || recording.ownerUserId === ownerUserId),
    );
    if (index < 0) {
      return null;
    }

    const [recording] = store.recordings.splice(index, 1);
    return recording ?? null;
  }

  pruneExpired(now = new Date()): string[] {
    const nowMs = now.getTime();
    const expiredIds: string[] = [];
    const nextRecordings = this.getStore().recordings.filter((recording) => {
      if (recording.saved || !recording.expiresAt) {
        return true;
      }

      const expiresMs = Date.parse(recording.expiresAt);
      if (!Number.isFinite(expiresMs) || expiresMs > nowMs) {
        return true;
      }

      expiredIds.push(recording.id);
      return false;
    });

    if (expiredIds.length) {
      this.getStore().recordings = nextRecordings;
    }

    return expiredIds;
  }
}

function getDefaultRecordingExpiryIso(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString();
}

function safeTimestamp(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
