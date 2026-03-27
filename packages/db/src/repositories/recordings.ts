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
}
