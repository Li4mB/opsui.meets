import type { MeetingRecord, MeetingSummaryRecord } from "../types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class MeetingsRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  listByWorkspace(workspaceId: string): MeetingRecord[] {
    return this.getStore().meetings.filter((meeting) => meeting.workspaceId === workspaceId);
  }

  create(meeting: MeetingRecord): MeetingRecord {
    const store = this.getStore();
    store.meetings.unshift(meeting);
    return meeting;
  }

  getById(id: string): MeetingRecord | null {
    return this.getStore().meetings.find((meeting) => meeting.id === id) ?? null;
  }

  getSummary(meetingInstanceId: string): MeetingSummaryRecord | null {
    return (
      this.getStore().meetingSummaries.find(
        (summary) => summary.meetingInstanceId === meetingInstanceId,
      ) ?? null
    );
  }

  initializeSummary(summary: MeetingSummaryRecord): MeetingSummaryRecord {
    const store = this.getStore();
    const index = store.meetingSummaries.findIndex(
      (item) => item.meetingInstanceId === summary.meetingInstanceId,
    );

    if (index >= 0) {
      store.meetingSummaries[index] = summary;
    } else {
      store.meetingSummaries.unshift(summary);
    }

    return summary;
  }

  updateSummary(
    meetingInstanceId: string,
    patch: Partial<MeetingSummaryRecord>,
  ): MeetingSummaryRecord | null {
    const store = this.getStore();
    const summary = store.meetingSummaries.find((item) => item.meetingInstanceId === meetingInstanceId) ?? null;
    if (!summary) {
      return null;
    }

    Object.assign(summary, patch);
    return summary;
  }

  setStatus(meetingInstanceId: string, status: MeetingRecord["status"]): MeetingRecord | null {
    const store = this.getStore();
    const meeting = store.meetings.find((item) => item.id === meetingInstanceId) ?? null;
    if (!meeting) {
      return null;
    }

    meeting.status = status;
    return meeting;
  }

  setLockState(meetingInstanceId: string, isLocked: boolean): MeetingRecord | null {
    const store = this.getStore();
    const meeting = store.meetings.find((item) => item.id === meetingInstanceId) ?? null;
    if (!meeting) {
      return null;
    }

    meeting.isLocked = isLocked;
    return meeting;
  }
}
