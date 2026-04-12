import type { MeetingRecord, RequestRepositoryContext, RoomRecord } from "@opsui/db";
import type { MeetingPostSummary, RoomPolicy, RoomSummary } from "@opsui/shared-types";

const SYSTEM_ACTOR_ID = "system_opsui_demo";
const DEMO_ROOM_SLUG = "opsui-demo";

interface SystemRoomDefinition {
  id: string;
  name: string;
  roomType: RoomSummary["roomType"];
  slug: string;
}

const SYSTEM_ROOMS: Record<string, SystemRoomDefinition> = {
  [DEMO_ROOM_SLUG]: {
    id: "room_opsui_demo",
    name: "OpsUI Demo",
    roomType: "persistent",
    slug: DEMO_ROOM_SLUG,
  },
};

export function ensureSystemRoom(
  repositories: RequestRepositoryContext,
  slug: string,
): { meeting: MeetingRecord | null; room: RoomRecord | null } {
  const definition = SYSTEM_ROOMS[slug];
  let room = repositories.rooms.getBySlug(slug);

  if (!room && definition) {
    room = repositories.rooms.create({
      id: definition.id,
      workspaceId: "workspace_local",
      name: definition.name,
      slug: definition.slug,
      roomType: definition.roomType,
      policy: buildSystemRoomPolicy(repositories),
      templateId: null,
      isPersistent: true,
      createdBy: SYSTEM_ACTOR_ID,
      createdAt: new Date().toISOString(),
    });
  }

  if (!room) {
    return { meeting: null, room: null };
  }

  let meeting = pickMeetingForRoom(repositories.meetings.listByWorkspace(room.workspaceId), room.id);
  if (definition && (!meeting || meeting.status === "ending" || meeting.status === "ended")) {
    meeting = createSystemMeeting(repositories, room, definition.name);
  }

  return {
    meeting,
    room,
  };
}

export function pickMeetingForRoom(meetings: MeetingRecord[], roomId: string): MeetingRecord | null {
  const candidates = meetings.filter((meeting) => meeting.roomId === roomId);
  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    const statusDelta = getMeetingPriority(left.status) - getMeetingPriority(right.status);
    if (statusDelta !== 0) {
      return statusDelta;
    }

    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });

  return candidates[0] ?? null;
}

function buildSystemRoomPolicy(repositories: RequestRepositoryContext): RoomPolicy {
  const workspacePolicy = repositories.policies.getWorkspacePolicy("workspace_local");
  if (workspacePolicy) {
    return {
      ...workspacePolicy.defaultRoomPolicy,
      allowGuestJoin: workspacePolicy.guestJoinMode !== "disabled",
    };
  }

  return {
    lobbyEnabled: true,
    allowGuestJoin: true,
    joinBeforeHost: false,
    mutedOnEntry: true,
    cameraOffOnEntry: false,
    lockAfterStart: false,
    chatMode: "open",
    screenShareMode: "presenters",
    recordingMode: "manual",
  };
}

function createSystemMeeting(
  repositories: RequestRepositoryContext,
  room: RoomRecord,
  roomName: string,
): MeetingRecord {
  const now = new Date().toISOString();
  const meeting: MeetingRecord = {
    id: crypto.randomUUID(),
    roomId: room.id,
    workspaceId: room.workspaceId,
    title: `${roomName} Meeting`,
    startsAt: now,
    status: "prejoin",
    createdAt: now,
    hostUserId: null,
    joinUrl: `https://opsuimeets.com/join?room=${encodeURIComponent(room.slug)}`,
    isLocked: false,
    createdBy: SYSTEM_ACTOR_ID,
  };

  repositories.meetings.create(meeting);
  repositories.meetings.initializeSummary(buildSystemMeetingSummary(meeting.title, meeting.id));
  repositories.recordings.upsert({
    id: `recording-${meeting.id}`,
    meetingInstanceId: meeting.id,
    provider: "cloudflare-realtime",
    status: "idle",
  });
  repositories.audit.append({
    actor: SYSTEM_ACTOR_ID,
    action: "system.demo_meeting.provisioned",
    target: room.slug,
  });

  return meeting;
}

function buildSystemMeetingSummary(title: string, meetingInstanceId: string): MeetingPostSummary & {
  meetingInstanceId: string;
} {
  return {
    meetingInstanceId,
    headline: `${title} is ready to join.`,
    attendanceCount: 0,
    actionItemCount: 0,
    recordingStatus: "idle",
    followUps: ["Waiting for the first participants to join the demo room."],
  };
}

function getMeetingPriority(status: MeetingRecord["status"]): number {
  switch (status) {
    case "live":
      return 0;
    case "prejoin":
      return 1;
    case "scheduled":
      return 2;
    case "ending":
      return 3;
    case "ended":
      return 4;
    default:
      return 5;
  }
}
