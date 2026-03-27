import type { RepositoryContext } from "@opsui/db";

export function syncMeetingSummary(
  repositories: RepositoryContext,
  meetingInstanceId: string,
): void {
  const meeting = repositories.meetings.getById(meetingInstanceId);
  if (!meeting) {
    return;
  }

  const participants = repositories.participants.listByMeetingInstance(meetingInstanceId);
  const events = repositories.events.listByMeetingInstance(meetingInstanceId);
  const actionItems = repositories.actionItems.listByMeetingInstance(meetingInstanceId);
  const recording = repositories.recordings.getByMeetingInstanceId(meetingInstanceId);
  const attendanceCount = participants.filter((participant) => Boolean(participant.joinedAt)).length;
  const activeCount = participants.filter((participant) => participant.presence === "active").length;
  const lobbyCount = participants.filter((participant) => participant.presence === "lobby").length;
  const openActionItems = actionItems.filter((item) => item.status === "open");
  const actionItemCount = openActionItems.length;
  const followUps = buildFollowUps({
    lobbyCount,
    openActionItems,
    raisedHandCount: events.filter((event) => event.type === "participant.hand_raised").length,
    recordingStatus: recording?.status ?? "idle",
  });

  repositories.meetings.updateSummary(meetingInstanceId, {
    headline: buildHeadline({
      meetingTitle: meeting.title,
      meetingStatus: meeting.status,
      attendanceCount,
      activeCount,
      lobbyCount,
      recordingStatus: recording?.status ?? "idle",
    }),
    attendanceCount,
    actionItemCount,
    recordingStatus: recording?.status ?? "idle",
    followUps,
  });
}

function buildHeadline(input: {
  meetingTitle: string;
  meetingStatus: "scheduled" | "prejoin" | "live" | "ending" | "ended";
  attendanceCount: number;
  activeCount: number;
  lobbyCount: number;
  recordingStatus: string;
}): string {
  if (input.meetingStatus === "ended") {
    return `${input.meetingTitle} ended with ${input.attendanceCount} attendees. Recording ${input.recordingStatus}.`;
  }

  if (input.meetingStatus === "live") {
    return `${input.meetingTitle} is live with ${input.activeCount} active participants and ${input.lobbyCount} waiting.`;
  }

  if (input.meetingStatus === "prejoin") {
    return `${input.meetingTitle} is ready to start. ${input.lobbyCount} waiting in lobby.`;
  }

  return `${input.meetingTitle} is scheduled and ready for host controls.`;
}

function buildFollowUps(input: {
  lobbyCount: number;
  openActionItems: Array<{ title: string }>;
  raisedHandCount: number;
  recordingStatus: string;
}): string[] {
  const items: string[] = [];

  if (input.recordingStatus === "stopped") {
    items.push("Publish recording and attach it to the follow-up thread.");
  }

  if (input.lobbyCount > 0) {
    items.push("Review lobby-only join attempts and decide whether outreach is needed.");
  }

  if (input.raisedHandCount > 0 && input.openActionItems.length === 0) {
    items.push(`Capture ${input.raisedHandCount} raised-hand follow-ups as owned action items.`);
  }

  for (const actionItem of input.openActionItems.slice(0, 3)) {
    items.push(`Action: ${actionItem.title}`);
  }

  if (items.length === 0) {
    items.push("No manual follow-up detected yet. Summary is ready for notes or task extraction.");
  }

  return items;
}
