import type {
  ActionItem,
  ChatMessageEventPayload,
  CreateActionItemInput,
  CreateMeetingInput,
  JoinMeetingResult,
  MeetingMediaSession,
  MeetingDetail,
  ParticipantState,
  RoomEvent,
  RoomSummary,
  SessionInfo,
} from "@opsui/shared-types";
import { buildActorHeadersFromSession, getActorHeaders } from "./auth";
import { API_BASE_URL } from "./config";
import { createIdempotencyKey } from "./idempotency";
import { getJoinSessionId } from "./join-session";

export async function createInstantMeeting(input: CreateMeetingInput): Promise<MeetingDetail | null> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("meeting-create"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/meetings`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });

    if (response.ok) {
      return (await response.json()) as MeetingDetail;
    }

    console.error("[opsui-meets] createInstantMeeting failed:", response.status, response.statusText);
  } catch (error) {
    console.error("[opsui-meets] createInstantMeeting error:", error);
  }

  return null;
}

export async function createRoom(input: {
  name: string;
  templateId?: string;
  roomType?: RoomSummary["roomType"];
  isPersistent?: boolean;
}): Promise<RoomSummary | null> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("room-create"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/rooms`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: input.name,
        templateId: input.templateId ?? null,
        roomType: input.roomType ?? "instant",
        isPersistent: input.isPersistent ?? false,
      }),
    });

    if (response.ok) {
      return (await response.json()) as RoomSummary;
    }

    console.error("[opsui-meets] createRoom failed:", response.status, response.statusText);
  } catch (error) {
    console.error("[opsui-meets] createRoom error:", error);
  }

  return null;
}

export async function joinMeeting(
  meetingInstanceId: string,
  roomId: string,
  displayName: string,
  sessionType = "guest",
): Promise<JoinMeetingResult | null> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("meeting-join"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/join`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        clientSessionId: getJoinSessionId(),
        roomId,
        displayName,
        sessionType,
      }),
    });

    if (response.ok) {
      return (await response.json()) as JoinMeetingResult;
    }

    console.error("[opsui-meets] joinMeeting failed:", response.status, response.statusText);
  } catch (error) {
    console.error("[opsui-meets] joinMeeting error:", error);
  }

  return null;
}

async function postCommand(pathname: string): Promise<boolean> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("moderation-command"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}${pathname}`, {
      method: "POST",
      headers,
    });

    return response.ok;
  } catch {}

  return false;
}

export function muteAllParticipants(meetingInstanceId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/moderation/mute-all`);
}

export function lockMeeting(meetingInstanceId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/moderation/lock`);
}

export function unlockMeeting(meetingInstanceId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/moderation/unlock`);
}

export function admitParticipant(meetingInstanceId: string, participantId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/participants/${participantId}/admit`);
}

export function removeParticipant(meetingInstanceId: string, participantId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/participants/${participantId}/remove`);
}

export function leaveMeetingParticipant(meetingInstanceId: string, participantId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/participants/${participantId}/leave`);
}

export async function sendChatMessage(
  meetingInstanceId: string,
  participantId: string,
  text: string,
): Promise<RoomEvent<ChatMessageEventPayload> | null> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("chat-message-send"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/chat/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        participantId,
        text,
      }),
    });

    if (response.ok) {
      return (await response.json()) as RoomEvent<ChatMessageEventPayload>;
    }
  } catch {}

  return null;
}

export function leaveMeetingParticipantInBackground(
  meetingInstanceId: string,
  participantId: string,
  session: SessionInfo | null,
): void {
  try {
    const headers = buildActorHeadersFromSession(session, {
      "Idempotency-Key": createIdempotencyKey("meeting-leave"),
    });
    void fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/participants/${participantId}/leave`, {
      method: "POST",
      headers,
      keepalive: true,
    });
  } catch {}
}

export async function touchMeetingParticipantSession(
  meetingInstanceId: string,
  participantId: string,
): Promise<ParticipantState | null> {
  try {
    const headers = await getActorHeaders(undefined, { includeJsonContentType: true });
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/participants/${participantId}/heartbeat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        clientSessionId: getJoinSessionId(),
      }),
    });

    if (response.ok) {
      return (await response.json()) as ParticipantState;
    }
  } catch {}

  return null;
}

export function startRecording(meetingInstanceId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/recordings/start`);
}

export function stopRecording(meetingInstanceId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/recordings/stop`);
}

export async function createMediaSession(
  meetingInstanceId: string,
  participantId: string,
  role: string,
  displayName: string,
): Promise<MeetingMediaSession | null> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("media-session-create"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/media-session`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        displayName,
        participantId,
        role,
      }),
    });

    if (response.ok) {
      return (await response.json()) as MeetingMediaSession;
    }
  } catch {}

  return null;
}

export function endMeeting(meetingInstanceId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/end`);
}

export async function exportAttendanceCsv(
  meetingInstanceId: string,
  meetingTitle: string,
): Promise<boolean> {
  try {
    const headers = await getActorHeaders();
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/attendance/export`, {
      headers,
    });

    if (!response.ok) {
      return false;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `attendance-${meetingTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "meeting"}.csv`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    return true;
  } catch {}

  return false;
}

export async function exportFollowUpBrief(
  meetingInstanceId: string,
  meetingTitle: string,
): Promise<boolean> {
  try {
    const headers = await getActorHeaders();
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/follow-up/export`, {
      headers,
    });

    if (!response.ok) {
      return false;
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `follow-up-${meetingTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "meeting"}.md`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    return true;
  } catch {}

  return false;
}

export async function dispatchFollowUpHook(meetingInstanceId: string): Promise<boolean> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("follow-up-dispatch"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/follow-up/dispatch`, {
      method: "POST",
      headers,
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as { ok: boolean };
    return payload.ok;
  } catch {}

  return false;
}

export async function dispatchFollowUpHookWithResult(
  meetingInstanceId: string,
): Promise<{ ok: boolean; errorMessage?: string }> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("follow-up-dispatch"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/follow-up/dispatch`, {
      method: "POST",
      headers,
    });

    if (response.ok) {
      const payload = (await response.json()) as { ok: boolean; status: number; targetUrl: string };
      if (payload.ok) {
        return { ok: true };
      }

      return {
        ok: false,
        errorMessage: `Summary hook dispatch failed at ${payload.targetUrl} [${payload.status || "network"}].`,
      };
    }

    return {
      ok: false,
      errorMessage: await getErrorMessage(response, "Summary hook dispatch failed."),
    };
  } catch {}

  return {
    ok: false,
    errorMessage: "Summary hook dispatch failed.",
  };
}

export async function retryFollowUpHookWithResult(
  meetingInstanceId: string,
): Promise<{ ok: boolean; errorMessage?: string }> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("follow-up-retry"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/follow-up/retry`, {
      method: "POST",
      headers,
    });

    if (response.ok) {
      const payload = (await response.json()) as { ok: boolean; status: number; targetUrl: string };
      if (payload.ok) {
        return { ok: true };
      }

      return {
        ok: false,
        errorMessage: `Summary hook retry failed at ${payload.targetUrl} [${payload.status || "network"}].`,
      };
    }

    return {
      ok: false,
      errorMessage: await getErrorMessage(response, "Summary hook retry failed."),
    };
  } catch {}

  return {
    ok: false,
    errorMessage: "Summary hook retry failed.",
  };
}

export async function createActionItem(
  meetingInstanceId: string,
  input: CreateActionItemInput,
): Promise<ActionItem | null> {
  try {
    const headers = await getActorHeaders(
      {
        "Idempotency-Key": createIdempotencyKey("action-item-create"),
      },
      { includeJsonContentType: true },
    );
    const response = await fetch(`${API_BASE_URL}/v1/meetings/${meetingInstanceId}/action-items`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });

    if (response.ok) {
      return (await response.json()) as ActionItem;
    }
  } catch {}

  return null;
}

export function completeActionItem(meetingInstanceId: string, actionItemId: string): Promise<boolean> {
  return postCommand(`/v1/meetings/${meetingInstanceId}/action-items/${actionItemId}/complete`);
}

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string; message?: string };
    switch (payload.error) {
      case "post_meeting_hook_target_required":
        return "Set a hook target URL before dispatching the follow-up.";
      case "post_meeting_hook_secret_required":
        return "Set a signing secret before dispatching the follow-up.";
      case "post_meeting_hook_disabled":
        return "Enable the post-meeting hook before dispatching the follow-up.";
      default:
        return payload.message ?? fallback;
    }
  } catch {
    return fallback;
  }
}
