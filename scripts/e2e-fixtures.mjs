import http from "node:http";
import { randomUUID } from "node:crypto";

const HOST = "127.0.0.1";
const API_PORT = Number(process.env.E2E_API_PORT ?? 9877);
const AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 9878);
const APP_ORIGIN = process.env.E2E_APP_ORIGIN ?? "http://127.0.0.1:4173";
const SESSION_COOKIE_NAME = "opsui_meets_e2e_auth";

let state = createInitialState();

const apiServer = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${API_PORT}`);
  if (request.method === "OPTIONS") {
    writeCorsHeaders(request, response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/__reset") {
    state = createInitialState();
    sendJson(request, response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/__participants/stale") {
    const body = await readJsonBody(request);
    const meetingId = String(body?.meetingInstanceId ?? "");
    const participantId = String(body?.participantId ?? "");
    const olderThanMs = Number(body?.olderThanMs ?? 3 * 60_000);
    const participant = findParticipant(meetingId, participantId);

    if (!participant) {
      sendJson(request, response, 404, { error: "participant_not_found" });
      return;
    }

    participant.sessionLastSeenAt = new Date(Date.now() - Math.max(olderThanMs, 0)).toISOString();
    sendJson(request, response, 200, {
      meetingInstanceId: meetingId,
      ok: true,
      participantId,
      sessionLastSeenAt: participant.sessionLastSeenAt,
    });
    return;
  }

  if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
    sendJson(request, response, 200, {
      ok: true,
      service: "opsui-meets-e2e-api",
      env: "test",
      dataMode: "memory",
      databaseConfigured: false,
      persistenceReady: true,
      analyticsConfigured: false,
    });
    return;
  }

  const roomResolveMatch = url.pathname.match(/^\/v1\/rooms\/resolve\/([^/]+)$/);
  if (request.method === "GET" && roomResolveMatch) {
    const room = getRoomBySlug(decodeURIComponent(roomResolveMatch[1]));
    if (!room) {
      sendJson(request, response, 404, { error: "room_not_found" });
      return;
    }

    sendJson(request, response, 200, room);
    return;
  }

  const roomStateMatch = url.pathname.match(/^\/v1\/rooms\/resolve\/([^/]+)\/state$/);
  if (request.method === "GET" && roomStateMatch) {
    const room = getRoomBySlug(decodeURIComponent(roomStateMatch[1]));
    if (!room) {
      sendJson(request, response, 404, { error: "room_not_found" });
      return;
    }

    const meeting = pickMeetingForRoom([...state.meetings.values()], room.id);
    if (!meeting) {
      sendJson(request, response, 200, {
        events: [],
        meeting: null,
        participants: [],
        recording: null,
        room,
      });
      return;
    }

    expireStaleParticipants(meeting.id);
    sendJson(request, response, 200, {
      events: state.events.get(meeting.id) ?? [],
      meeting,
      participants: state.participants.get(meeting.id) ?? [],
      recording: state.recordings.get(meeting.id) ?? null,
      room,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/rooms") {
    const body = await readJsonBody(request);
    const room = createRoom({
      isPersistent: Boolean(body?.isPersistent),
      name: String(body?.name ?? "New Room"),
      roomType: body?.roomType ?? "instant",
    });
    sendJson(request, response, 200, room);
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/meetings") {
    const items = [...state.meetings.values()]
      .map(toMeetingSummary)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    sendJson(request, response, 200, { items });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/meetings") {
    const body = await readJsonBody(request);
    const room = state.rooms.get(String(body?.roomId ?? ""));
    if (!room) {
      sendJson(request, response, 404, { error: "room_not_found" });
      return;
    }

    const meeting = createMeeting({
      room,
      startsAt: String(body?.startsAt ?? new Date().toISOString()),
      title: String(body?.title ?? `Meeting ${room.slug.toUpperCase()}`),
    });
    sendJson(request, response, 200, meeting);
    return;
  }

  const meetingDetailMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)$/);
  if (request.method === "GET" && meetingDetailMatch) {
    const meeting = state.meetings.get(meetingDetailMatch[1]);
    if (!meeting) {
      sendJson(request, response, 404, { error: "meeting_not_found" });
      return;
    }

    sendJson(request, response, 200, meeting);
    return;
  }

  const participantsMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/participants$/);
  if (request.method === "GET" && participantsMatch) {
    sendJson(request, response, 200, {
      items: state.participants.get(participantsMatch[1]) ?? [],
    });
    return;
  }

  const eventsMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/events$/);
  if (request.method === "GET" && eventsMatch) {
    sendJson(request, response, 200, {
      items: state.events.get(eventsMatch[1]) ?? [],
    });
    return;
  }

  const recordingsMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/recordings$/);
  if (request.method === "GET" && recordingsMatch) {
    const recording = state.recordings.get(recordingsMatch[1]);
    if (!recording) {
      sendJson(request, response, 404, { error: "recording_not_found" });
      return;
    }

    sendJson(request, response, 200, recording);
    return;
  }

  const joinMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/join$/);
  if (request.method === "POST" && joinMatch) {
    const meeting = state.meetings.get(joinMatch[1]);
    if (!meeting) {
      sendJson(request, response, 404, { error: "meeting_not_found" });
      return;
    }

    const room = state.rooms.get(meeting.roomId);
    if (!room) {
      sendJson(request, response, 404, { error: "room_not_found" });
      return;
    }

    const body = await readJsonBody(request);
    const clientSessionId = typeof body?.clientSessionId === "string" && body.clientSessionId.trim()
      ? body.clientSessionId.trim()
      : null;
    const displayName = String(body?.displayName ?? "Guest User").trim() || "Guest User";
    const sessionType = body?.sessionType === "user" ? "user" : "guest";

    if (meeting.isLocked && sessionType === "guest") {
      sendJson(request, response, 200, {
        displayName,
        joinState: "blocked",
        meetingInstanceId: meeting.id,
        reason: "room_locked",
        roomId: room.id,
      });
      return;
    }

    if (!room.policy.allowGuestJoin && sessionType === "guest") {
      sendJson(request, response, 200, {
        displayName,
        joinState: "blocked",
        meetingInstanceId: meeting.id,
        reason: "guest_join_disabled",
        roomId: room.id,
      });
      return;
    }

    const participant = findParticipantByJoinSession(meeting.id, clientSessionId) ?? createParticipant({
      displayName,
      joinSessionId: clientSessionId,
      meetingId: meeting.id,
      role: sessionType === "user" ? "owner" : "participant",
    });
    participant.displayName = displayName;
    participant.presence = sessionType === "user" ? "active" : "lobby";
    participant.reconnectingSinceAt = null;
    participant.reconnectingToPresence = null;
    participant.sessionLastSeenAt = new Date().toISOString();
    participant.audio = room.policy.mutedOnEntry ? "muted" : "unmuted";
    participant.video = room.policy.cameraOffOnEntry ? "off" : "on";
    if (!(state.participants.get(meeting.id) ?? []).some((entry) => entry.participantId === participant.participantId)) {
      state.participants.get(meeting.id)?.push(participant);
    }

    if (sessionType === "user") {
      meeting.status = "live";
      meeting.hostUserId = String(request.headers["x-user-id"] ?? participant.participantId);
      addEvent(meeting.id, "participant.join", { displayName });
    } else {
      addEvent(meeting.id, "lobby.updated", { displayName });
    }

    sendJson(request, response, 200, {
      displayName,
      joinState: sessionType === "user" ? "direct" : "lobby",
      meetingInstanceId: meeting.id,
      participantId: participant.participantId,
      roomId: room.id,
    });
    return;
  }

  const chatMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/chat\/messages$/);
  if (request.method === "POST" && chatMatch) {
    const meetingId = chatMatch[1];
    const body = await readJsonBody(request);
    const participant = findParticipant(meetingId, String(body?.participantId ?? ""));
    const text = String(body?.text ?? "").trim();

    if (!participant) {
      sendJson(request, response, 404, { error: "participant_not_found" });
      return;
    }

    if (!text) {
      sendJson(request, response, 400, { error: "chat_text_required" });
      return;
    }

    const event = addEvent(
      meetingId,
      "chat.message_sent",
      {
        displayName: participant.displayName,
        text,
      },
      participant.participantId,
    );
    sendJson(request, response, 201, event);
    return;
  }

  const admitMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/participants\/([^/]+)\/admit$/);
  if (request.method === "POST" && admitMatch) {
    const participant = findParticipant(admitMatch[1], admitMatch[2]);
    if (!participant) {
      sendJson(request, response, 404, { error: "participant_not_found" });
      return;
    }

    participant.presence = "active";
    participant.reconnectingSinceAt = null;
    participant.reconnectingToPresence = null;
    addEvent(admitMatch[1], "participant.admitted", { participantId: participant.participantId });
    sendJson(request, response, 200, { ok: true });
    return;
  }

  const removeMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/participants\/([^/]+)\/remove$/);
  if (request.method === "POST" && removeMatch) {
    const participant = findParticipant(removeMatch[1], removeMatch[2]);
    if (!participant) {
      sendJson(request, response, 404, { error: "participant_not_found" });
      return;
    }

    participant.presence = "left";
    participant.reconnectingSinceAt = null;
    participant.reconnectingToPresence = null;
    addEvent(removeMatch[1], "participant.removed", { participantId: participant.participantId });
    sendJson(request, response, 200, { ok: true });
    return;
  }

  const leaveMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/participants\/([^/]+)\/leave$/);
  if (request.method === "POST" && leaveMatch) {
    const participant = findParticipant(leaveMatch[1], leaveMatch[2]);
    if (!participant) {
      sendJson(request, response, 404, { error: "participant_not_found" });
      return;
    }

    participant.presence = "left";
    participant.reconnectingSinceAt = null;
    participant.reconnectingToPresence = null;
    participant.audio = "muted";
    participant.video = "off";
    addEvent(leaveMatch[1], "participant.leave", { participantId: participant.participantId });
    sendJson(request, response, 200, { ok: true });
    return;
  }

  const heartbeatMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/participants\/([^/]+)\/heartbeat$/);
  if (request.method === "POST" && heartbeatMatch) {
    const participant = findParticipant(heartbeatMatch[1], heartbeatMatch[2]);
    if (!participant || participant.presence === "left") {
      sendJson(request, response, 404, { error: "participant_not_found" });
      return;
    }

    const body = await readJsonBody(request);
    const clientSessionId = typeof body?.clientSessionId === "string" && body.clientSessionId.trim()
      ? body.clientSessionId.trim()
      : null;
    if (clientSessionId && participant.joinSessionId && participant.joinSessionId !== clientSessionId) {
      sendJson(request, response, 404, { error: "participant_not_found" });
      return;
    }

    participant.sessionLastSeenAt = new Date().toISOString();
    if (participant.presence === "reconnecting") {
      participant.presence = participant.reconnectingToPresence ?? "active";
      participant.reconnectingSinceAt = null;
      participant.reconnectingToPresence = null;
    }
    sendJson(request, response, 200, participant);
    return;
  }

  const muteAllMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/moderation\/mute-all$/);
  if (request.method === "POST" && muteAllMatch) {
    for (const participant of state.participants.get(muteAllMatch[1]) ?? []) {
      if (participant.presence === "active") {
        participant.audio = "muted";
      }
    }
    addEvent(muteAllMatch[1], "participants.muted_all", {});
    sendJson(request, response, 200, { ok: true });
    return;
  }

  const lockMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/moderation\/lock$/);
  if (request.method === "POST" && lockMatch) {
    const meeting = state.meetings.get(lockMatch[1]);
    if (!meeting) {
      sendJson(request, response, 404, { error: "meeting_not_found" });
      return;
    }

    meeting.isLocked = true;
    addEvent(lockMatch[1], "room.locked", {});
    sendJson(request, response, 200, { ok: true });
    return;
  }

  const unlockMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/moderation\/unlock$/);
  if (request.method === "POST" && unlockMatch) {
    const meeting = state.meetings.get(unlockMatch[1]);
    if (!meeting) {
      sendJson(request, response, 404, { error: "meeting_not_found" });
      return;
    }

    meeting.isLocked = false;
    addEvent(unlockMatch[1], "room.unlocked", {});
    sendJson(request, response, 200, { ok: true });
    return;
  }

  const recordingStartMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/recordings\/start$/);
  if (request.method === "POST" && recordingStartMatch) {
    const recording = state.recordings.get(recordingStartMatch[1]);
    if (!recording) {
      sendJson(request, response, 404, { error: "recording_not_found" });
      return;
    }

    recording.status = "recording";
    recording.startedAt = new Date().toISOString();
    addEvent(recordingStartMatch[1], "recording.started", {});
    sendJson(request, response, 200, { ok: true });
    return;
  }

  const recordingStopMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/recordings\/stop$/);
  if (request.method === "POST" && recordingStopMatch) {
    const recording = state.recordings.get(recordingStopMatch[1]);
    if (!recording) {
      sendJson(request, response, 404, { error: "recording_not_found" });
      return;
    }

    recording.status = "stopped";
    recording.stoppedAt = new Date().toISOString();
    addEvent(recordingStopMatch[1], "recording.stopped", {});
    sendJson(request, response, 200, { ok: true });
    return;
  }

  const endMatch = url.pathname.match(/^\/v1\/meetings\/([^/]+)\/end$/);
  if (request.method === "POST" && endMatch) {
    const meeting = state.meetings.get(endMatch[1]);
    if (!meeting) {
      sendJson(request, response, 404, { error: "meeting_not_found" });
      return;
    }

    meeting.status = "ended";
    addEvent(endMatch[1], "room.ended", {});
    sendJson(request, response, 200, { ok: true });
    return;
  }

  sendJson(request, response, 404, { error: "not_found" });
});

const authServer = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}:${AUTH_PORT}`);
  if (request.method === "OPTIONS") {
    writeCorsHeaders(request, response);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/__reset") {
    state = createInitialState();
    writeCorsHeaders(request, response);
    response.setHeader("Set-Cookie", buildExpiredCookie());
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
    sendJson(request, response, 200, {
      ok: true,
      service: "opsui-meets-e2e-auth",
      appEnv: "test",
      mockAuthEnabled: true,
      sessionSigningConfigured: false,
      oidcConfigured: false,
      membershipDirectoryConfigured: false,
      membershipEnforced: false,
      workspaceMappingConfigured: false,
      roleMappingConfigured: false,
      workspaceAllowlistConfigured: false,
      analyticsConfigured: false,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/session") {
    sendJson(request, response, 200, getCurrentSession(request));
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/session/mock") {
    const body = await readJsonBody(request);
    const session = createUserSession(String(body?.email ?? "member@example.com"));
    const token = randomUUID();
    state.authSessions.set(token, session);

    writeCorsHeaders(request, response);
    response.setHeader("Set-Cookie", buildSessionCookie(token));
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ actor: session.actor, ok: true }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/login") {
    const redirectTo = url.searchParams.get("redirectTo") ?? "/";
    const session = createUserSession("member@example.com");
    const token = randomUUID();
    state.authSessions.set(token, session);

    response.setHeader("Set-Cookie", buildSessionCookie(token));
    response.writeHead(302, {
      Location: `${APP_ORIGIN}${redirectTo}`,
    });
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/logout") {
    const token = parseCookies(request.headers.cookie ?? "")[SESSION_COOKIE_NAME];
    if (token) {
      state.authSessions.delete(token);
    }

    writeCorsHeaders(request, response);
    response.setHeader("Set-Cookie", buildExpiredCookie());
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  sendJson(request, response, 404, { error: "not_found" });
});

Promise.all([
  listen(apiServer, API_PORT, "API"),
  listen(authServer, AUTH_PORT, "Auth"),
]).then(() => {
  console.log(`[e2e-fixtures] ready on ${HOST}:${API_PORT} and ${HOST}:${AUTH_PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await Promise.allSettled([
      closeServer(apiServer),
      closeServer(authServer),
    ]);
    process.exit(0);
  });
}

function createInitialState() {
  const nextState = {
    authSessions: new Map(),
    events: new Map(),
    meetings: new Map(),
    nextEventNumber: 1,
    nextMeetingNumber: 1,
    nextParticipantNumber: 1,
    nextRoomNumber: 1,
    participants: new Map(),
    recordings: new Map(),
    rooms: new Map(),
  };

  seedRoom(nextState, {
    name: "Legacy Planning",
    slug: "ops-legacy",
    title: "Legacy Planning",
  });
  seedRoom(nextState, {
    isPersistent: true,
    name: "OpsUI Demo",
    roomType: "persistent",
    slug: "opsui-demo",
    title: "OpsUI Demo Meeting",
  });
  seedRoom(nextState, {
    name: "Auto Join Room",
    slug: "ops-signin",
    title: "Auto Join Room",
  });
  seedRoom(nextState, {
    name: "Auth Redirect Room",
    slug: "ops-login",
    title: "Auth Redirect Room",
  });

  return nextState;
}

function seedRoom(nextState, input) {
  const room = {
    id: `room_${nextState.nextRoomNumber++}`,
    workspaceId: "workspace_local",
    name: input.name,
    policy: createDefaultPolicy(),
    roomType: input.roomType ?? "instant",
    slug: input.slug,
  };

  nextState.rooms.set(room.id, room);
  const meeting = {
    createdAt: new Date().toISOString(),
    hostUserId: null,
    id: `meeting_${nextState.nextMeetingNumber++}`,
    isLocked: false,
    joinUrl: `${APP_ORIGIN}/${room.slug}`,
    roomId: room.id,
    startsAt: new Date().toISOString(),
    status: "prejoin",
    title: input.title,
    workspaceId: room.workspaceId,
  };
  nextState.meetings.set(meeting.id, meeting);
  nextState.participants.set(meeting.id, []);
  nextState.events.set(meeting.id, []);
  nextState.recordings.set(meeting.id, {
    id: `recording_${meeting.id}`,
    meetingInstanceId: meeting.id,
    provider: "mock",
    status: "idle",
  });
}

function createDefaultPolicy() {
  return {
    allowGuestJoin: true,
    cameraOffOnEntry: true,
    chatMode: "open",
    joinBeforeHost: true,
    lobbyEnabled: true,
    lockAfterStart: false,
    mutedOnEntry: false,
    recordingMode: "manual",
    screenShareMode: "everyone",
  };
}

function createRoom(input) {
  const slug = normalizeSlug(input.name);
  const uniqueSlug = ensureUniqueSlug(slug);
  const room = {
    id: `room_${state.nextRoomNumber++}`,
    workspaceId: "workspace_local",
    name: input.name,
    policy: createDefaultPolicy(),
    roomType: input.roomType,
    slug: uniqueSlug,
  };
  state.rooms.set(room.id, room);
  return room;
}

function createMeeting(input) {
  const meeting = {
    createdAt: new Date().toISOString(),
    hostUserId: null,
    id: `meeting_${state.nextMeetingNumber++}`,
    isLocked: false,
    joinUrl: `${APP_ORIGIN}/${input.room.slug}`,
    roomId: input.room.id,
    startsAt: input.startsAt,
    status: "prejoin",
    title: input.title,
    workspaceId: input.room.workspaceId,
  };
  state.meetings.set(meeting.id, meeting);
  state.participants.set(meeting.id, []);
  state.events.set(meeting.id, []);
  state.recordings.set(meeting.id, {
    id: `recording_${meeting.id}`,
    meetingInstanceId: meeting.id,
    provider: "mock",
    status: "idle",
  });
  return meeting;
}

function createParticipant(input) {
  return {
    audio: "unmuted",
    displayName: input.displayName,
    handRaised: false,
    joinSessionId: input.joinSessionId ?? null,
    joinedAt: new Date().toISOString(),
    meetingInstanceId: input.meetingId,
    participantId: `participant_${state.nextParticipantNumber++}`,
    presence: "lobby",
    reconnectingSinceAt: null,
    reconnectingToPresence: null,
    role: input.role,
    sessionLastSeenAt: new Date().toISOString(),
    video: "off",
  };
}

function pickMeetingForRoom(meetings, roomId) {
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

function getMeetingPriority(status) {
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

function addEvent(meetingId, type, payload, actorParticipantId = undefined) {
  const event = {
    actorParticipantId,
    eventId: `event_${state.nextEventNumber}`,
    meetingInstanceId: meetingId,
    occurredAt: new Date().toISOString(),
    payload,
    roomEventNumber: state.nextEventNumber++,
    type,
  };
  state.events.get(meetingId)?.push(event);
  return event;
}

function toMeetingSummary(meeting) {
  return {
    createdAt: meeting.createdAt,
    id: meeting.id,
    roomId: meeting.roomId,
    startsAt: meeting.startsAt,
    status: meeting.status,
    title: meeting.title,
    workspaceId: meeting.workspaceId,
  };
}

function getRoomBySlug(slug) {
  for (const room of state.rooms.values()) {
    if (room.slug === slug) {
      return room;
    }
  }
  return null;
}

function ensureUniqueSlug(baseSlug) {
  let suffix = 0;
  let candidate = baseSlug;
  while (getRoomBySlug(candidate)) {
    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }
  return candidate;
}

function normalizeSlug(value) {
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `ops-room-${randomUUID().slice(0, 8)}`;
}

function findParticipant(meetingId, participantId) {
  return (state.participants.get(meetingId) ?? []).find((participant) => participant.participantId === participantId) ?? null;
}

function findParticipantByJoinSession(meetingId, joinSessionId) {
  if (!joinSessionId) {
    return null;
  }

  return (state.participants.get(meetingId) ?? []).find((participant) => participant.joinSessionId === joinSessionId) ?? null;
}

function expireStaleParticipants(meetingId, staleAfterMs = 2 * 60_000) {
  const cutoff = Date.now() - staleAfterMs;
  const reconnectGraceMs = 5 * 60_000;
  for (const participant of state.participants.get(meetingId) ?? []) {
    if (participant.presence === "left" || !participant.sessionLastSeenAt) {
      continue;
    }

    if (Date.parse(participant.sessionLastSeenAt) > cutoff) {
      continue;
    }

    if (participant.presence === "reconnecting") {
      const reconnectingSinceAt = participant.reconnectingSinceAt
        ? Date.parse(participant.reconnectingSinceAt)
        : Number.NaN;
      if (Number.isFinite(reconnectingSinceAt) && Date.now() - reconnectingSinceAt <= reconnectGraceMs) {
        continue;
      }

      participant.presence = "left";
      participant.audio = "muted";
      participant.video = "off";
      participant.handRaised = false;
      participant.reconnectingSinceAt = null;
      participant.reconnectingToPresence = null;
      continue;
    }

    participant.reconnectingSinceAt = new Date().toISOString();
    participant.reconnectingToPresence = participant.presence === "lobby" ? "lobby" : "active";
    participant.presence = "reconnecting";
  }
}

function getCurrentSession(request) {
  const token = parseCookies(request.headers.cookie ?? "")[SESSION_COOKIE_NAME];
  if (!token) {
    return createGuestSession();
  }

  return state.authSessions.get(token) ?? createGuestSession();
}

function createGuestSession() {
  return {
    actor: {
      userId: "guest_anonymous",
      workspaceId: "workspace_local",
    },
    authenticated: false,
    provider: "anonymous",
    sessionType: "guest",
  };
}

function createUserSession(email) {
  const trimmedEmail = email.trim() || "member@example.com";
  const localPart = trimmedEmail.split("@")[0] ?? "member";
  return {
    actor: {
      email: trimmedEmail,
      membershipSource: "mock",
      userId: `mock_${localPart.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
      workspaceId: "workspace_local",
      workspaceRole: "owner",
    },
    authenticated: true,
    provider: "mock",
    sessionType: "user",
  };
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex === -1) {
          return [entry, ""];
        }

        return [
          entry.slice(0, separatorIndex),
          decodeURIComponent(entry.slice(separatorIndex + 1)),
        ];
      }),
  );
}

function buildSessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Max-Age=86400; Path=/; SameSite=Lax`;
}

function buildExpiredCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax`;
}

function writeCorsHeaders(request, response) {
  const origin = request.headers.origin;
  if (origin && [APP_ORIGIN, "http://localhost:4173"].includes(origin)) {
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }

  response.setHeader(
    "Access-Control-Allow-Headers",
    "content-type, idempotency-key, x-idempotency-key, x-user-id, x-user-email, x-workspace-id, x-workspace-role",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(request, response, status, payload) {
  writeCorsHeaders(request, response);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      if (!body) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        resolve(null);
      }
    });
  });
}

function listen(server, port, label) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      console.log(`[e2e-fixtures] ${label} listening on http://${HOST}:${port}`);
      resolve();
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
