import { getRepositories } from "../lib/data";
import { notFound } from "../lib/http";
import type { Env } from "../types";

export async function exportAttendance(meetingInstanceId: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.getById(meetingInstanceId);

  if (!meeting) {
    return notFound();
  }

  const rows = repositories.participants
    .listByMeetingInstance(meetingInstanceId)
    .map((participant) => [
      participant.participantId,
      participant.displayName,
      participant.role,
      participant.presence,
      participant.audio,
      participant.video,
      participant.joinedAt ?? "",
    ]);

  const csv = [
    ["participant_id", "display_name", "role", "presence", "audio", "video", "joined_at"],
    ...rows,
  ]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");

  await repositories.commit();
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${buildFilename(meeting.title)}.csv"`,
    },
  });
}

function buildFilename(title: string): string {
  return `attendance-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "meeting"}`;
}

function escapeCsvValue(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }

  return value;
}
