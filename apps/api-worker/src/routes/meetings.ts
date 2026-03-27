import type { CreateMeetingInput, MeetingDetail } from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { withIdempotency } from "../lib/idempotency";
import { syncMeetingSummary } from "../lib/meeting-summary";
import { syncRealtimeRoomState } from "../lib/realtime";
import { ApiError, json } from "../lib/http";
import { optionalIsoDate, parseJson, requireNonEmptyString } from "../lib/request";
import type { Env } from "../types";

export async function createMeeting(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<CreateMeetingInput>(request);

  const result = await withIdempotency(request, "meetings.create", async () => {
    const roomId = requireNonEmptyString(payload.roomId, "room_id_required");
    const title = requireNonEmptyString(payload.title, "meeting_title_required", "Untitled meeting");
    const startsAt = optionalIsoDate(payload.startsAt, new Date().toISOString(), "invalid_starts_at");
    const room = repositories.rooms.getById(roomId);
    if (!room) {
      throw new ApiError(404, "room_not_found");
    }
    const startTimestamp = Date.parse(startsAt);
    const isStartingSoon = startTimestamp <= Date.now() + 10 * 60 * 1000;

    const meeting: MeetingDetail & { createdBy: string } = {
      id: crypto.randomUUID(),
      roomId,
      workspaceId: actor.workspaceId,
      title,
      startsAt,
      status: isStartingSoon ? "prejoin" : "scheduled",
      createdAt: new Date().toISOString(),
      hostUserId: actor.userId,
      joinUrl: `https://opsuimeets.com/join?room=${encodeURIComponent(room.slug)}`,
      isLocked: false,
      createdBy: actor.userId,
    };

    repositories.meetings.create(meeting);
    repositories.meetings.initializeSummary({
      meetingInstanceId: meeting.id,
      headline: `Session created for ${meeting.title}. Summary will populate after attendance and follow-up processing.`,
      attendanceCount: 0,
      actionItemCount: 0,
      recordingStatus: "idle",
      followUps: ["Waiting for first joins, recording activity, or moderation events."],
    });
    repositories.recordings.upsert({
      id: `recording-${meeting.id}`,
      meetingInstanceId: meeting.id,
      provider: "cloudflare-realtime",
      status: "idle",
    });
    syncMeetingSummary(repositories, meeting.id);
    repositories.audit.append({
      actor: actor.email ?? actor.userId,
      action: "meeting.created",
      target: meeting.title,
    });
    await syncRealtimeRoomState(env, meeting.id, {
      meetingStatus: meeting.status,
      lockState: "unlocked",
      recordingState: "idle",
    });

    return {
      body: meeting,
      status: 201,
    };
  });

  await repositories.commit();
  return json(result.body, { status: result.status });
}

export async function listMeetings(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const response = json({ items: repositories.meetings.listByWorkspace(actor.workspaceId) });
  await repositories.commit();
  return response;
}
