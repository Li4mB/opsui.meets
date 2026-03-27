import type { MeetingFollowUpPackage, WorkspacePolicy } from "@opsui/shared-types";
import type { RepositoryContext } from "@opsui/db";
import { ApiError } from "./http";

export function buildMeetingFollowUpPackage(
  repositories: RepositoryContext,
  meetingInstanceId: string,
): MeetingFollowUpPackage {
  const meeting = repositories.meetings.getById(meetingInstanceId);
  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  const summary = repositories.meetings.getSummary(meetingInstanceId);
  const participants = repositories.participants.listByMeetingInstance(meetingInstanceId);
  const actionItems = repositories.actionItems.listByMeetingInstance(meetingInstanceId);
  const recording = repositories.recordings.getByMeetingInstanceId(meetingInstanceId);

  return {
    generatedAt: new Date().toISOString(),
    meeting,
    summary: summary ?? {
      headline: "No summary is available yet.",
      attendanceCount: participants.filter((participant) => Boolean(participant.joinedAt)).length,
      actionItemCount: actionItems.filter((item) => item.status === "open").length,
      recordingStatus: recording?.status ?? "idle",
      followUps: ["Prepare notes and assign owners before distribution."],
    },
    recording,
    participants,
    actionItems,
    attendance: {
      joined: participants.filter((participant) => Boolean(participant.joinedAt)).length,
      active: participants.filter((participant) => participant.presence === "active").length,
      lobby: participants.filter((participant) => participant.presence === "lobby").length,
      left: participants.filter((participant) => participant.presence === "left").length,
    },
  };
}

export function filterHookPayload(
  pkg: MeetingFollowUpPackage,
  policy: WorkspacePolicy,
): Record<string, unknown> {
  return {
    generatedAt: pkg.generatedAt,
    meeting: pkg.meeting,
    summary: pkg.summary,
    attendance: policy.postMeetingHook.includeAttendance ? pkg.attendance : undefined,
    participants: policy.postMeetingHook.includeAttendance ? pkg.participants : undefined,
    actionItems: policy.postMeetingHook.includeActionItems ? pkg.actionItems : undefined,
    recording: policy.postMeetingHook.includeRecording ? pkg.recording : undefined,
  };
}

export function buildFollowUpMarkdown(pkg: MeetingFollowUpPackage): string {
  const openItems = pkg.actionItems.filter((item) => item.status === "open");
  const doneItems = pkg.actionItems.filter((item) => item.status === "done");

  return [
    `# ${pkg.meeting.title}`,
    "",
    `Generated: ${pkg.generatedAt}`,
    `Meeting status: ${pkg.meeting.status}`,
    `Scheduled start: ${pkg.meeting.startsAt}`,
    `Join URL: ${pkg.meeting.joinUrl}`,
    "",
    "## Summary",
    "",
    pkg.summary.headline,
    "",
    `- Attendance count: ${pkg.summary.attendanceCount}`,
    `- Open action items: ${pkg.summary.actionItemCount}`,
    `- Recording status: ${pkg.summary.recordingStatus}`,
    "",
    "## Follow-Ups",
    "",
    ...pkg.summary.followUps.map((followUp) => `- ${followUp}`),
    "",
    "## Attendance Snapshot",
    "",
    `- Joined: ${pkg.attendance.joined}`,
    `- Active: ${pkg.attendance.active}`,
    `- Lobby: ${pkg.attendance.lobby}`,
    `- Left: ${pkg.attendance.left}`,
    "",
    "## Open Action Items",
    "",
    ...(openItems.length > 0
      ? openItems.map(
          (item) =>
            `- ${item.title}${item.ownerLabel ? ` (owner: ${item.ownerLabel})` : ""}${item.dueAt ? ` (due: ${item.dueAt.slice(0, 10)})` : ""}`,
        )
      : ["- None"]),
    "",
    "## Completed Action Items",
    "",
    ...(doneItems.length > 0
      ? doneItems.map(
          (item) =>
            `- ${item.title}${item.ownerLabel ? ` (owner: ${item.ownerLabel})` : ""}${item.dueAt ? ` (due: ${item.dueAt.slice(0, 10)})` : ""}`,
        )
      : ["- None"]),
    "",
    "## Participant Roster",
    "",
    ...pkg.participants.map(
      (participant) =>
        `- ${participant.displayName} | ${participant.role} | ${participant.presence} | audio ${participant.audio} | video ${participant.video}`,
    ),
    "",
    "## Recording",
    "",
    pkg.recording
      ? `- ${pkg.recording.provider} | ${pkg.recording.status}${pkg.recording.startedAt ? ` | started ${pkg.recording.startedAt}` : ""}${pkg.recording.stoppedAt ? ` | stopped ${pkg.recording.stoppedAt}` : ""}`
      : "- No recording record available",
    "",
  ].join("\n");
}

export function buildFollowUpFilename(title: string): string {
  return `follow-up-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "meeting"}`;
}
