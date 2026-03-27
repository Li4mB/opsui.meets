import type { AdminOverview, DashboardSummary } from "@opsui/shared-types";
import type { HookDeliveryAttempt } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class DashboardRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  getWorkspaceDashboard(workspaceId: string): DashboardSummary {
    const store = this.getStore();
    const roomsCount = store.rooms.filter((room) => room.workspaceId === workspaceId).length;
    const meetings = store.meetings.filter((meeting) => meeting.workspaceId === workspaceId);
    const meetingsCount = meetings.length;
    const meetingIds = new Set(meetings.map((meeting) => meeting.id));
    const participants = store.participants.filter((participant) => meetingIds.has(participant.meetingInstanceId));

    return {
      roomsCount,
      meetingsCount,
      activeParticipants: participants.filter((participant) => participant.presence === "active").length,
      lobbyParticipants: participants.filter((participant) => participant.presence === "lobby").length,
      raisedHands: participants.filter((participant) => participant.handRaised).length,
    };
  }

  getAdminOverview(workspaceId: string): AdminOverview {
    const store = this.getStore();
    const today = new Date().toISOString().slice(0, 10);
    const meetings = store.meetings.filter((meeting) => meeting.workspaceId === workspaceId);
    const meetingIds = new Set(meetings.map((meeting) => meeting.id));
    const liveMeetingIds = new Set(
      store.participants
        .filter(
          (participant) =>
            participant.presence === "active" && meetingIds.has(participant.meetingInstanceId),
        )
        .map((participant) => participant.meetingInstanceId),
    );
    const lobbyCount = store.participants.filter(
      (participant) => participant.presence === "lobby" && meetingIds.has(participant.meetingInstanceId),
    ).length;
    const recordingsToday = store.recordings.filter(
      (recording) =>
        meetingIds.has(recording.meetingInstanceId) &&
        (
          (recording.startedAt && recording.startedAt.startsWith(today)) ||
          (recording.stoppedAt && recording.stoppedAt.startsWith(today))
        ),
    ).length;
    const workspaceAttempts = store.hookDeliveries.filter((attempt) => attempt.workspaceId === workspaceId);
    const currentMeetingFailures = getLatestMeetingAttempts(workspaceAttempts).filter((attempt) => !attempt.ok);
    const historicalFailures = workspaceAttempts.filter((attempt) => !attempt.ok).length;
    const autoOnEndFailures = currentMeetingFailures.filter((attempt) => attempt.trigger === "meeting_end_auto").length;
    const moderationActions = store.auditLogs.filter((entry) =>
      /^(room\.|participant\.|participants\.|lobby\.|join\.)/.test(entry.action),
    ).length;

    return {
      metrics: [
        { label: "Live rooms", value: String(liveMeetingIds.size) },
        { label: "Lobby waits > 2 min", value: String(lobbyCount) },
        { label: "Recordings today", value: String(recordingsToday) },
        { label: "Current hook failures", value: String(currentMeetingFailures.length) },
        { label: "Auto-on-end failures", value: String(autoOnEndFailures) },
        { label: "Historical hook failures", value: String(historicalFailures) },
        { label: "Moderation actions", value: String(moderationActions) },
      ],
    };
  }
}

function getLatestMeetingAttempts(attempts: HookDeliveryAttempt[]): HookDeliveryAttempt[] {
  const latestByMeeting = new Map<string, HookDeliveryAttempt>();

  return attempts.filter((attempt) => {
    if (!attempt.meetingInstanceId || attempt.trigger === "admin_test") {
      return false;
    }

    if (latestByMeeting.has(attempt.meetingInstanceId)) {
      return false;
    }

    latestByMeeting.set(attempt.meetingInstanceId, attempt);
    return true;
  });
}
