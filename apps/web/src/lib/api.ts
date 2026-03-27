import type {
  ActionItem,
  RecordingSummary,
  DashboardSummary,
  HookDeliveryAttempt,
  MeetingDetail,
  MeetingPostSummary,
  MeetingSummary,
  ParticipantState,
  RoomEvent,
  RoomSummary,
  TemplateSummary,
} from "@opsui/shared-types";
import { MOCK_PARTICIPANTS, MOCK_ROOM } from "../mockData";
import { getActorHeaders } from "./auth";
import { API_BASE_URL } from "./config";

export interface DashboardPayload {
  primaryMeeting: MeetingDetail | null;
  rooms: RoomSummary[];
  meetings: MeetingSummary[];
  templates: TemplateSummary[];
  participants: ParticipantState[];
  roomEvents: RoomEvent[];
  actionItems: ActionItem[];
  followUpAttempts: HookDeliveryAttempt[];
  meetingSummary: MeetingPostSummary;
  recording: RecordingSummary | null;
  summary: DashboardSummary;
}

export async function getDashboardPayload(focusMeetingInstanceId?: string): Promise<DashboardPayload> {
  try {
    const actorHeaders = await getActorHeaders();
    const [roomsRes, meetingsRes, templatesRes, dashboardRes] = await Promise.all([
      fetch(`${API_BASE_URL}/v1/rooms`, {
        headers: actorHeaders,
      }),
      fetch(`${API_BASE_URL}/v1/meetings`, {
        headers: actorHeaders,
      }),
      fetch(`${API_BASE_URL}/v1/templates`, {
        headers: actorHeaders,
      }),
      fetch(`${API_BASE_URL}/v1/dashboard`, {
        headers: actorHeaders,
      }),
    ]);

    if (roomsRes.ok && meetingsRes.ok && templatesRes.ok && dashboardRes.ok) {
      const roomsJson = (await roomsRes.json()) as { items: RoomSummary[] };
      const meetingsJson = (await meetingsRes.json()) as { items: MeetingSummary[] };
      const templatesJson = (await templatesRes.json()) as { items: TemplateSummary[] };
      const summary = (await dashboardRes.json()) as DashboardSummary;
      const resolvedMeetingId = meetingsJson.items.some((meeting) => meeting.id === focusMeetingInstanceId)
        ? focusMeetingInstanceId
        : meetingsJson.items[0]?.id;
      let primaryMeeting: MeetingDetail | null = null;
      let participants = MOCK_PARTICIPANTS;
      let roomEvents: RoomEvent[] = [];
      let actionItems: ActionItem[] = [];
      let followUpAttempts: HookDeliveryAttempt[] = [];
      let meetingSummary: MeetingPostSummary = {
        headline: "Summary pending transcript and action-item extraction.",
        attendanceCount: participants.filter((item) => item.presence === "active").length,
        actionItemCount: 1,
        recordingStatus: "idle",
        followUps: ["Prepare post-meeting notes and assign owners."],
      };
      let recording: RecordingSummary | null = null;

      if (resolvedMeetingId) {
        const [detailRes, participantsRes, eventsRes, summaryRes, recordingRes, actionItemsRes, followUpAttemptsRes] = await Promise.all([
          fetch(`${API_BASE_URL}/v1/meetings/${resolvedMeetingId}`, {
            headers: actorHeaders,
          }),
          fetch(`${API_BASE_URL}/v1/meetings/${resolvedMeetingId}/participants`, {
            headers: actorHeaders,
          }),
          fetch(`${API_BASE_URL}/v1/meetings/${resolvedMeetingId}/events`, {
            headers: actorHeaders,
          }),
          fetch(`${API_BASE_URL}/v1/meetings/${resolvedMeetingId}/summary`, {
            headers: actorHeaders,
          }),
          fetch(`${API_BASE_URL}/v1/meetings/${resolvedMeetingId}/recordings`, {
            headers: actorHeaders,
          }),
          fetch(`${API_BASE_URL}/v1/meetings/${resolvedMeetingId}/action-items`, {
            headers: actorHeaders,
          }),
          fetch(`${API_BASE_URL}/v1/meetings/${resolvedMeetingId}/follow-up/attempts`, {
            headers: actorHeaders,
          }),
        ]);

        if (detailRes.ok) {
          primaryMeeting = (await detailRes.json()) as MeetingDetail;
        }

        if (participantsRes.ok) {
          const participantsJson = (await participantsRes.json()) as { items: ParticipantState[] };
          participants = participantsJson.items;
          meetingSummary = {
            ...meetingSummary,
            attendanceCount: participants.filter((item) => item.presence === "active").length,
          };
        }

        if (eventsRes.ok) {
          const eventsJson = (await eventsRes.json()) as { items: RoomEvent[] };
          roomEvents = eventsJson.items;
        }

        if (summaryRes.ok) {
          meetingSummary = (await summaryRes.json()) as typeof meetingSummary;
        }

        if (recordingRes.ok) {
          recording = (await recordingRes.json()) as RecordingSummary;
        }

        if (actionItemsRes.ok) {
          const actionItemsJson = (await actionItemsRes.json()) as { items: ActionItem[] };
          actionItems = actionItemsJson.items;
        }

        if (followUpAttemptsRes.ok) {
          const attemptsJson = (await followUpAttemptsRes.json()) as { items: HookDeliveryAttempt[] };
          followUpAttempts = attemptsJson.items;
        }
      }

      return {
        rooms: roomsJson.items,
        meetings: meetingsJson.items,
        templates: templatesJson.items,
        primaryMeeting,
        participants,
        roomEvents,
        actionItems,
        followUpAttempts,
        meetingSummary,
        recording,
        summary,
      };
    }
  } catch {}

  return {
    primaryMeeting: {
      id: "meeting_today",
      roomId: MOCK_ROOM.id,
      workspaceId: MOCK_ROOM.workspaceId,
      title: "Operations Daily Handoff",
      status: "scheduled",
      startsAt: "2026-03-26T09:00:00.000Z",
      createdAt: "2026-03-26T08:42:00.000Z",
      hostUserId: "user_local",
      joinUrl: "https://opsuimeets.com/join?room=operations-standup",
      isLocked: false,
    },
    rooms: [MOCK_ROOM],
    meetings: [
      {
        id: "meeting_today",
        roomId: MOCK_ROOM.id,
        workspaceId: MOCK_ROOM.workspaceId,
        title: "Operations Daily Handoff",
        status: "scheduled",
        startsAt: "2026-03-26T09:00:00.000Z",
        createdAt: "2026-03-26T08:42:00.000Z",
      },
    ],
    templates: [
      {
        id: "template_standup",
        workspaceId: MOCK_ROOM.workspaceId,
        name: "Internal Standup",
        templateType: "standup",
        description: "Fast daily team sync with muted entry and presenter screenshare.",
        isSystem: true,
      },
      {
        id: "template_training",
        workspaceId: MOCK_ROOM.workspaceId,
        name: "Training Session",
        templateType: "training",
        description: "Instructor-led room with moderated join and attendance tracking.",
        isSystem: true,
      },
    ],
    participants: MOCK_PARTICIPANTS,
    roomEvents: [
      {
        eventId: "evt_1",
        roomEventNumber: 1,
        type: "participant.join",
        meetingInstanceId: "meeting_today",
        occurredAt: "2026-03-26T08:55:00.000Z",
        actorParticipantId: "p_host_1",
        payload: {
          participantId: "p_host_1",
        },
      },
      {
        eventId: "evt_2",
        roomEventNumber: 2,
        type: "participant.hand_raised",
        meetingInstanceId: "meeting_today",
        occurredAt: "2026-03-26T09:02:00.000Z",
        actorParticipantId: "p_mod_1",
        payload: {
          participantId: "p_mod_1",
        },
      },
    ],
    actionItems: [
      {
        id: "action_1",
        meetingInstanceId: "meeting_today",
        sourceType: "system",
        title: "Review raised-hand follow-up from Amira Vale.",
        status: "open",
        createdAt: "2026-03-26T09:06:00.000Z",
      },
      {
        id: "action_2",
        meetingInstanceId: "meeting_today",
        sourceType: "manual",
        title: "Send attendance export to operations leads.",
        ownerLabel: "Jordan Hale",
        status: "done",
        createdAt: "2026-03-26T09:10:00.000Z",
      },
    ],
    followUpAttempts: [
      {
        id: "hook_attempt_1",
        workspaceId: "workspace_local",
        meetingInstanceId: "meeting_today",
        meetingTitle: "Operations Daily Handoff",
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
    meetingSummary: {
      headline: "Summary pending transcript and action-item extraction.",
      attendanceCount: 2,
      actionItemCount: 1,
      recordingStatus: "idle",
      followUps: ["Action: Review raised-hand follow-up from Amira Vale.", "Confirm whether a recording is needed."],
    },
    recording: {
      id: "recording-meeting_today",
      meetingInstanceId: "meeting_today",
      provider: "cloudflare-realtime",
      status: "idle",
    },
    summary: {
      roomsCount: 1,
      meetingsCount: 1,
      activeParticipants: 2,
      lobbyParticipants: 1,
      raisedHands: 1,
    },
  };
}
