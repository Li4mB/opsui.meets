import type { MeetingRecord, MeetingSummaryRecord, RoomRecord } from "./types";
import type {
  ActionItem,
  AuditLogEntry,
  HookDeliveryAttempt,
  ParticipantState,
  RecordingSummary,
  RoomEvent,
  TemplateSummary,
  WorkspacePolicy,
} from "@opsui/shared-types";

export interface StoredParticipantState extends ParticipantState {
  joinSessionId?: string;
  sessionLastSeenAt?: string;
}

export interface MemoryStore {
  rooms: RoomRecord[];
  meetings: MeetingRecord[];
  templates: TemplateSummary[];
  participants: StoredParticipantState[];
  recordings: RecordingSummary[];
  actionItems: ActionItem[];
  hookDeliveries: HookDeliveryAttempt[];
  meetingSummaries: MeetingSummaryRecord[];
  auditLogs: AuditLogEntry[];
  roomEvents: RoomEvent[];
  workspacePolicy: WorkspacePolicy;
}

const MAX_AUDIT_LOGS = 200;
const MAX_HOOK_DELIVERIES = 200;
const MAX_LEFT_PARTICIPANTS_PER_MEETING = 40;
const MAX_TOTAL_PARTICIPANTS = 1_500;
const LEFT_PARTICIPANT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_ROOM_EVENTS_PER_MEETING = 100;
const MAX_TOTAL_ROOM_EVENTS = 1_000;

const globalKey = "__opsui_meets_memory_store__";

export type MemoryStoreAccessor = () => MemoryStore;

export function createSeedStore(): MemoryStore {
  const room: RoomRecord = {
    id: "room_ops_standup",
    workspaceId: "workspace_local",
    name: "Operations Standup",
    slug: "operations-standup",
    roomType: "persistent",
    policy: {
      lobbyEnabled: true,
      allowGuestJoin: true,
      joinBeforeHost: false,
      mutedOnEntry: true,
      cameraOffOnEntry: false,
      lockAfterStart: false,
      chatMode: "open",
      screenShareMode: "presenters",
      recordingMode: "manual",
    },
    templateId: "template_standup",
    isPersistent: true,
    createdBy: "user_local",
    createdAt: "2026-03-26T08:40:00.000Z",
  };

  const meeting: MeetingRecord = {
    id: "meeting_today",
    roomId: room.id,
    workspaceId: room.workspaceId,
    title: "Operations Daily Handoff",
    status: "scheduled",
    startsAt: "2026-03-26T09:00:00.000Z",
    createdAt: "2026-03-26T08:42:00.000Z",
    hostUserId: "user_local",
    joinUrl: "https://opsuimeets.com/join?room=operations-standup",
    isLocked: false,
    createdBy: "user_local",
  };

  return {
    rooms: [room],
    meetings: [meeting],
    templates: [
      {
        id: "template_standup",
        workspaceId: room.workspaceId,
        name: "Internal Standup",
        templateType: "standup",
        description: "Fast daily team sync with muted entry and presenter screenshare.",
        isSystem: true,
      },
      {
        id: "template_training",
        workspaceId: room.workspaceId,
        name: "Training Session",
        templateType: "training",
        description: "Instructor-led room with moderated join and attendance tracking.",
        isSystem: true,
      },
    ],
    participants: [
      {
        participantId: "p_host_1",
        meetingInstanceId: meeting.id,
        displayName: "Jordan Hale",
        role: "host",
        presence: "active",
        audio: "unmuted",
        video: "on",
        handRaised: false,
        joinedAt: "2026-03-26T08:55:00.000Z",
      },
      {
        participantId: "p_mod_1",
        meetingInstanceId: meeting.id,
        displayName: "Amira Vale",
        role: "moderator",
        presence: "active",
        audio: "muted",
        video: "on",
        handRaised: true,
        joinedAt: "2026-03-26T08:56:00.000Z",
      },
      {
        participantId: "p_participant_1",
        meetingInstanceId: meeting.id,
        displayName: "Noah Pike",
        role: "participant",
        presence: "lobby",
        audio: "muted",
        video: "off",
        handRaised: false,
      },
    ],
    recordings: [
      {
        id: "recording-meeting_today",
        meetingInstanceId: "meeting_today",
        provider: "cloudflare-realtime",
        status: "idle",
      },
    ],
    actionItems: [
      {
        id: "action_1",
        meetingInstanceId: meeting.id,
        sourceType: "system",
        title: "Review raised-hand follow-up from Amira Vale.",
        status: "open",
        createdAt: "2026-03-26T09:06:00.000Z",
      },
      {
        id: "action_2",
        meetingInstanceId: meeting.id,
        sourceType: "manual",
        title: "Send attendance export to operations leads.",
        ownerLabel: "Jordan Hale",
        status: "done",
        createdAt: "2026-03-26T09:10:00.000Z",
      },
    ],
    hookDeliveries: [
      {
        id: "hook_attempt_1",
        workspaceId: room.workspaceId,
        meetingInstanceId: meeting.id,
        meetingTitle: meeting.title,
        actor: "Jordan Hale",
        trigger: "manual_dispatch",
        eventType: "meeting.follow_up",
        deliveryMode: "manual",
        targetUrl: "https://ops.example.com/hooks/meet-follow-up",
        ok: false,
        statusCode: 503,
        occurredAt: "2026-03-26T09:12:00.000Z",
      },
    ],
    meetingSummaries: [
      {
        meetingInstanceId: "meeting_today",
        headline: "Summary pending transcript and action-item extraction.",
        attendanceCount: 2,
        actionItemCount: 1,
        recordingStatus: "idle",
        followUps: [
          "Action: Review raised-hand follow-up from Amira Vale.",
          "Confirm whether the recording should be published.",
        ],
      },
    ],
    auditLogs: [
      {
        id: "audit_1",
        actor: "Jordan Hale",
        action: "recording.started",
        target: "Operations Daily Handoff",
        occurredAt: "2026-03-26T09:01:00.000Z",
      },
      {
        id: "audit_2",
        actor: "Amira Vale",
        action: "lobby.admit",
        target: "Noah Pike",
        occurredAt: "2026-03-26T09:03:00.000Z",
      },
      {
        id: "audit_3",
        actor: "Jordan Hale",
        action: "participants.mute_all",
        target: "Operations Daily Handoff",
        occurredAt: "2026-03-26T09:04:00.000Z",
      },
    ],
    roomEvents: [
      {
        eventId: "evt_1",
        roomEventNumber: 1,
        type: "participant.join",
        meetingInstanceId: meeting.id,
        occurredAt: "2026-03-26T08:55:00.000Z",
        actorParticipantId: "p_host_1",
        payload: {
          participantId: "p_host_1",
          displayName: "Jordan Hale",
          role: "host",
        },
      },
      {
        eventId: "evt_2",
        roomEventNumber: 2,
        type: "participant.hand_raised",
        meetingInstanceId: meeting.id,
        occurredAt: "2026-03-26T09:02:00.000Z",
        actorParticipantId: "p_mod_1",
        payload: {
          participantId: "p_mod_1",
        },
      },
      {
        eventId: "evt_3",
        roomEventNumber: 3,
        type: "recording.started",
        meetingInstanceId: meeting.id,
        occurredAt: "2026-03-26T09:04:00.000Z",
        actorParticipantId: "p_host_1",
        payload: {
          recordingId: "recording-meeting_today",
        },
      },
    ],
    workspacePolicy: {
      workspaceId: room.workspaceId,
      defaultRoomPolicy: room.policy,
      guestJoinMode: "restricted",
      recordingAccess: "owner_host_only",
      postMeetingHook: {
        enabled: false,
        deliveryMode: "manual",
        targetUrl: "",
        secret: "",
        hasSecret: false,
        includeAttendance: true,
        includeActionItems: true,
        includeRecording: true,
      },
    },
  };
}

export function compactRuntimeStore(store: MemoryStore): boolean {
  let changed = false;

  changed = trimArray(store.auditLogs, MAX_AUDIT_LOGS) || changed;
  changed = trimArray(store.hookDeliveries, MAX_HOOK_DELIVERIES) || changed;

  const compactedParticipants = compactParticipants(store.participants);
  if (compactedParticipants !== store.participants) {
    store.participants = compactedParticipants;
    changed = true;
  }

  const compactedRoomEvents = compactRoomEvents(store.roomEvents);
  if (compactedRoomEvents !== store.roomEvents) {
    store.roomEvents = compactedRoomEvents;
    changed = true;
  }

  return changed;
}

export function getMemoryStore(): MemoryStore {
  const globalScope = globalThis as typeof globalThis & {
    [globalKey]?: MemoryStore;
  };

  if (!globalScope[globalKey]) {
    globalScope[globalKey] = createSeedStore();
  }

  return globalScope[globalKey];
}

function trimArray<T>(values: T[], limit: number): boolean {
  if (values.length <= limit) {
    return false;
  }

  values.length = limit;
  return true;
}

function compactRoomEvents(events: RoomEvent[]): RoomEvent[] {
  if (events.length <= MAX_TOTAL_ROOM_EVENTS) {
    return events;
  }

  const countsByMeeting = new Map<string, number>();
  const nextEvents: RoomEvent[] = [];

  for (const event of events) {
    const currentCount = countsByMeeting.get(event.meetingInstanceId) ?? 0;
    if (currentCount >= MAX_ROOM_EVENTS_PER_MEETING) {
      continue;
    }

    countsByMeeting.set(event.meetingInstanceId, currentCount + 1);
    nextEvents.push(event);

    if (nextEvents.length >= MAX_TOTAL_ROOM_EVENTS) {
      break;
    }
  }

  return nextEvents.length === events.length ? events : nextEvents;
}

function compactParticipants(participants: StoredParticipantState[]): StoredParticipantState[] {
  const nextParticipants: StoredParticipantState[] = [];
  const leftCountsByMeeting = new Map<string, number>();
  const now = Date.now();

  for (const participant of participants) {
    if (participant.presence !== "left") {
      nextParticipants.push(participant);
      continue;
    }

    if (isExpiredLeftParticipant(participant, now)) {
      continue;
    }

    const currentCount = leftCountsByMeeting.get(participant.meetingInstanceId) ?? 0;
    if (currentCount >= MAX_LEFT_PARTICIPANTS_PER_MEETING) {
      continue;
    }

    if (nextParticipants.length >= MAX_TOTAL_PARTICIPANTS) {
      continue;
    }

    leftCountsByMeeting.set(participant.meetingInstanceId, currentCount + 1);
    nextParticipants.push(participant);
  }

  return nextParticipants.length === participants.length ? participants : nextParticipants;
}

function isExpiredLeftParticipant(participant: StoredParticipantState, now: number): boolean {
  const recencyTimestamp = participant.sessionLastSeenAt ?? participant.joinedAt;
  if (!recencyTimestamp) {
    return true;
  }

  const recencyMs = Date.parse(recencyTimestamp);
  if (!Number.isFinite(recencyMs)) {
    return true;
  }

  return now - recencyMs > LEFT_PARTICIPANT_RETENTION_MS;
}
