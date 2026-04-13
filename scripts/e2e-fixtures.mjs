import http from "node:http";
import { randomUUID } from "node:crypto";

const HOST = "127.0.0.1";
const API_PORT = Number(process.env.E2E_API_PORT ?? 9877);
const AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 9878);
const APP_ORIGIN = process.env.E2E_APP_ORIGIN ?? "http://127.0.0.1:4173";
const SESSION_COOKIE_NAME = "opsui_meets_e2e_auth";
const OIDC_PENDING_COOKIE_NAME = "opsui_meets_e2e_oidc_pending";

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

  if (request.method === "GET" && url.pathname === "/v1/direct-messages/threads") {
    const session = getCurrentSession(request);
    if (!session.authenticated) {
      sendJson(request, response, 401, {
        error: "authentication_required",
        message: "Sign in to use direct messages.",
      });
      return;
    }

    sendJson(request, response, 200, {
      items: listDirectMessageThreadsForUser(session.actor.userId),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/direct-messages/search") {
    const session = getCurrentSession(request);
    if (!session.authenticated) {
      sendJson(request, response, 401, {
        error: "authentication_required",
        message: "Sign in to use direct messages.",
      });
      return;
    }

    const query = (url.searchParams.get("query") ?? "").trim().toLowerCase();
    if (!query) {
      sendJson(request, response, 200, { items: [] });
      return;
    }

    const items = [...state.users.values()]
      .filter((user) => user.id !== session.actor.userId)
      .map((user) => ({
        score: getFixtureUsernameMatchScore(user.usernameNormalized, query),
        user,
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.user.usernameNormalized.localeCompare(right.user.usernameNormalized);
      })
      .slice(0, 20)
      .map((entry) => toDirectMessageSearchResult(entry.user));

    sendJson(request, response, 200, { items });
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/direct-messages/threads") {
    const session = getCurrentSession(request);
    if (!session.authenticated) {
      sendJson(request, response, 401, {
        error: "authentication_required",
        message: "Sign in to use direct messages.",
      });
      return;
    }

    const body = await readJsonBody(request);
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const target = findUserByNormalizedUsername(username);
    if (!target) {
      sendJson(request, response, 404, {
        error: "user_not_found",
        message: "No account matches that username.",
      });
      return;
    }

    if (target.id === session.actor.userId) {
      sendJson(request, response, 400, {
        error: "cannot_message_self",
        message: "Choose someone else to start a direct message.",
      });
      return;
    }

    const thread = getOrCreateFixtureDirectMessageThread(session.actor.userId, target.id);
    sendJson(request, response, 200, toDirectMessageThreadDetail(thread, session.actor.userId));
    return;
  }

  const directMessageThreadMatch = url.pathname.match(/^\/v1\/direct-messages\/threads\/([^/]+)$/);
  if (request.method === "GET" && directMessageThreadMatch) {
    const session = getCurrentSession(request);
    if (!session.authenticated) {
      sendJson(request, response, 401, {
        error: "authentication_required",
        message: "Sign in to use direct messages.",
      });
      return;
    }

    const thread = state.directMessageThreads.get(directMessageThreadMatch[1]) ?? null;
    if (!thread || !getDirectMessageMembership(thread.id, session.actor.userId)) {
      sendJson(request, response, 404, {
        error: "thread_not_found",
        message: "That direct message thread was not found.",
      });
      return;
    }

    sendJson(request, response, 200, toDirectMessageThreadDetail(thread, session.actor.userId));
    return;
  }

  const directMessageMessagesMatch = url.pathname.match(/^\/v1\/direct-messages\/threads\/([^/]+)\/messages$/);
  if (request.method === "GET" && directMessageMessagesMatch) {
    const session = getCurrentSession(request);
    if (!session.authenticated) {
      sendJson(request, response, 401, {
        error: "authentication_required",
        message: "Sign in to use direct messages.",
      });
      return;
    }

    const thread = state.directMessageThreads.get(directMessageMessagesMatch[1]) ?? null;
    if (!thread || !getDirectMessageMembership(thread.id, session.actor.userId)) {
      sendJson(request, response, 404, {
        error: "thread_not_found",
        message: "That direct message thread was not found.",
      });
      return;
    }

    sendJson(request, response, 200, {
      items: listDirectMessageMessagesByThread(thread.id).map(toDirectMessageMessage),
    });
    return;
  }

  if (request.method === "POST" && directMessageMessagesMatch) {
    const session = getCurrentSession(request);
    if (!session.authenticated) {
      sendJson(request, response, 401, {
        error: "authentication_required",
        message: "Sign in to use direct messages.",
      });
      return;
    }

    const thread = state.directMessageThreads.get(directMessageMessagesMatch[1]) ?? null;
    if (!thread || !getDirectMessageMembership(thread.id, session.actor.userId)) {
      sendJson(request, response, 404, {
        error: "thread_not_found",
        message: "That direct message thread was not found.",
      });
      return;
    }

    const body = await readJsonBody(request);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      sendJson(request, response, 400, {
        error: "message_text_required",
        message: "Enter a message before sending.",
      });
      return;
    }

    const message = {
      id: `dm_message_${state.nextDirectMessageMessageNumber++}`,
      threadId: thread.id,
      senderUserId: session.actor.userId,
      body: text,
      sentAt: new Date().toISOString(),
    };
    state.directMessageMessages.push(message);
    thread.lastMessageAt = message.sentAt;
    thread.lastMessagePreview = createDirectMessagePreview(text);
    thread.updatedAt = message.sentAt;

    const senderMembership = getDirectMessageMembership(thread.id, session.actor.userId);
    if (senderMembership) {
      senderMembership.lastReadAt = message.sentAt;
      senderMembership.lastReadMessageId = message.id;
    }

    sendJson(request, response, 201, toDirectMessageMessage(message));
    return;
  }

  const directMessageReadMatch = url.pathname.match(/^\/v1\/direct-messages\/threads\/([^/]+)\/read$/);
  if (request.method === "POST" && directMessageReadMatch) {
    const session = getCurrentSession(request);
    if (!session.authenticated) {
      sendJson(request, response, 401, {
        error: "authentication_required",
        message: "Sign in to use direct messages.",
      });
      return;
    }

    const thread = state.directMessageThreads.get(directMessageReadMatch[1]) ?? null;
    const membership = thread ? getDirectMessageMembership(thread.id, session.actor.userId) : null;
    if (!thread || !membership) {
      sendJson(request, response, 404, {
        error: "thread_not_found",
        message: "That direct message thread was not found.",
      });
      return;
    }

    const latestMessage = listDirectMessageMessagesByThread(thread.id).at(-1) ?? null;
    membership.lastReadAt = latestMessage?.sentAt ?? new Date().toISOString();
    membership.lastReadMessageId = latestMessage?.id ?? null;
    sendJson(request, response, 200, { ok: true });
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
      workspaceId: String(request.headers["x-workspace-id"] ?? "workspace_local"),
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
    response.setHeader("Set-Cookie", [
      buildExpiredCookie(),
      buildExpiredCookie(OIDC_PENDING_COOKIE_NAME),
    ]);
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
      passwordAuthEnabled: true,
      signupEnabled: true,
      sessionSigningConfigured: false,
      oidcConfigured: true,
      opsuiValidationConfigured: true,
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

  if (request.method === "POST" && url.pathname === "/v1/login/password") {
    const body = await readJsonBody(request);
    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === "string" ? body.password : "";
    const user = findUserByEmail(email);
    const credential = user ? state.credentials.get(user.id) ?? null : null;

    if (!user || !credential || credential.password !== password) {
      sendJson(request, response, 401, {
        error: "invalid_credentials",
        message: "Email or password is incorrect.",
      });
      return;
    }

    const membership = state.memberships.find((entry) => entry.userId === user.id) ?? null;
    const workspace = membership ? state.workspaces.get(membership.workspaceId) ?? null : null;
    if (!membership || !workspace) {
      sendJson(request, response, 403, {
        error: "membership_not_found",
        message: "That account is not attached to a workspace.",
      });
      return;
    }

    const session = createUserSessionFromRecords(user, workspace, membership, "password");
    const token = randomUUID();
    state.authSessions.set(token, session);

    writeCorsHeaders(request, response);
    response.setHeader("Set-Cookie", buildSessionCookie(token));
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, actor: session.actor }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/oidc/complete-account") {
    const body = await readJsonBody(request);
    const usernameValidation = validateFixtureUsername(body?.username);
    if (!usernameValidation.ok) {
      sendJson(request, response, 400, {
        error: usernameValidation.error,
        message: usernameValidation.message,
      });
      return;
    }

    const pendingToken = parseCookies(request.headers.cookie ?? "")[OIDC_PENDING_COOKIE_NAME];
    const pending = pendingToken ? state.pendingOidcSessions.get(pendingToken) ?? null : null;
    if (!pending) {
      sendJson(request, response, 401, {
        error: "oidc_completion_not_available",
        message: "Start sign-in with your identity provider before completing your account.",
      });
      return;
    }

    if (findUserByNormalizedUsername(usernameValidation.usernameNormalized)) {
      sendJson(request, response, 409, {
        error: "username_already_exists",
        message: "That username is already taken.",
      });
      return;
    }

    if (pending.email && findUserByEmail(pending.email)) {
      sendJson(request, response, 409, {
        error: "email_already_exists",
        message: "An account with that email already exists.",
      });
      return;
    }

    const workspace = state.workspaces.get(pending.workspaceId) ?? null;
    if (!workspace) {
      sendJson(request, response, 409, {
        error: "oidc_workspace_not_found",
        message: "The workspace for this sign-in could not be found.",
      });
      return;
    }

    const user = createUser({
      email: pending.email || `oidc-${pending.subject}@opsuimeets.local`,
      username: usernameValidation.username,
      usernameNormalized: usernameValidation.usernameNormalized,
      firstName: pending.firstName,
      lastName: pending.lastName,
    });
    const membership = createMembership({
      membershipSource: pending.membershipSource,
      role: pending.workspaceRole,
      userId: user.id,
      workspaceId: workspace.id,
    });

    state.users.set(user.id, user);
    state.externalIdentities.set(`oidc:${pending.subject}`, user.id);
    state.pendingOidcSessions.delete(pendingToken);

    const session = createUserSessionFromRecords(user, workspace, membership, "oidc");
    const token = randomUUID();
    state.authSessions.set(token, session);

    writeCorsHeaders(request, response);
    response.setHeader("Set-Cookie", [
      buildSessionCookie(token),
      buildExpiredCookie(OIDC_PENDING_COOKIE_NAME),
    ]);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      ok: true,
      actor: session.actor,
      redirectTo: pending.redirectTo ?? "/",
    }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/signup/individual") {
    const body = await readJsonBody(request);
    const parsed = parseFixtureIdentity(body);
    if (!parsed.ok) {
      sendJson(request, response, 400, parsed.error);
      return;
    }

    if (findUserByEmail(parsed.email)) {
      sendJson(request, response, 409, {
        error: "email_already_exists",
        message: "An account with that email already exists.",
      });
      return;
    }

    if (findUserByNormalizedUsername(parsed.usernameNormalized)) {
      sendJson(request, response, 409, {
        error: "username_already_exists",
        message: "That username is already taken.",
      });
      return;
    }

    const workspace = createWorkspace({
      name: `${parsed.firstName} ${parsed.lastName}'s Workspace`,
      planTier: "standard",
      workspaceKind: "personal",
    });
    const user = createUser(parsed);
    const membership = createMembership({
      membershipSource: "password_individual",
      role: "owner",
      userId: user.id,
      workspaceId: workspace.id,
    });

    state.users.set(user.id, user);
    state.credentials.set(user.id, {
      hashVersion: "pbkdf2_sha256_v1",
      password: parsed.password,
    });

    const session = createUserSessionFromRecords(user, workspace, membership, "password");
    const token = randomUUID();
    state.authSessions.set(token, session);

    writeCorsHeaders(request, response);
    response.setHeader("Set-Cookie", buildSessionCookie(token));
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, actor: session.actor }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/signup/organisation") {
    const body = await readJsonBody(request);
    const parsed = parseFixtureIdentity(body);
    const organizationName = typeof body?.organizationName === "string" ? body.organizationName.trim() : "";
    const linkToOpsui = body?.linkToOpsui === true;
    if (!parsed.ok || !organizationName) {
      sendJson(request, response, 400, {
        error: !organizationName ? "organization_name_required" : parsed.error.error,
        message: !organizationName ? "Organisation name is required." : parsed.error.message,
      });
      return;
    }

    if (findUserByEmail(parsed.email)) {
      sendJson(request, response, 409, {
        error: "email_already_exists",
        message: "An account with that email already exists.",
      });
      return;
    }

    if (findUserByNormalizedUsername(parsed.usernameNormalized)) {
      sendJson(request, response, 409, {
        error: "username_already_exists",
        message: "That username is already taken.",
      });
      return;
    }

    const organizationNameNormalized = normalizeOrganizationName(organizationName);
    if (!organizationNameNormalized) {
      sendJson(request, response, 400, {
        error: "organization_name_required",
        message: "Organisation name is required.",
      });
      return;
    }

    if (findWorkspaceByNormalizedOrganizationName(organizationNameNormalized)) {
      sendJson(request, response, 409, {
        error: "organization_name_already_exists",
        message: "An organisation with that name already exists.",
      });
      return;
    }

    const validation = linkToOpsui ? validateFixtureOpsuiCredentials(parsed.email, parsed.password) : null;
    if (linkToOpsui && !validation?.ok) {
      sendJson(request, response, 403, {
        error: validation?.code ?? "invalid_credentials",
        message: getFixtureOpsuiMessage(validation?.code ?? "invalid_credentials"),
      });
      return;
    }

    const workspace = createWorkspace({
      name: organizationName,
      opsuiBusinessId: validation?.businessId ?? null,
      organizationCode: generateFixtureOrganizationCode(),
      opsuiLinked: linkToOpsui,
      planTier: linkToOpsui ? "super" : "standard",
      workspaceKind: "organisation",
      organizationNameNormalized,
    });
    const user = createUser(parsed);
    const membership = createMembership({
      membershipSource: linkToOpsui ? "opsui_organisation_owner" : "password_organisation_owner",
      role: "owner",
      userId: user.id,
      workspaceId: workspace.id,
    });

    state.users.set(user.id, user);
    state.credentials.set(user.id, {
      hashVersion: "pbkdf2_sha256_v1",
      password: parsed.password,
    });

    const session = createUserSessionFromRecords(user, workspace, membership, "password");
    const token = randomUUID();
    state.authSessions.set(token, session);

    writeCorsHeaders(request, response);
    response.setHeader("Set-Cookie", buildSessionCookie(token));
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, actor: session.actor }));
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/signup/business") {
    const body = await readJsonBody(request);
    const parsed = parseFixtureIdentity(body);
    const organizationCode = typeof body?.organizationCode === "string" ? body.organizationCode.trim().toUpperCase() : "";
    if (!parsed.ok || !organizationCode) {
      sendJson(request, response, 400, {
        error: !organizationCode ? "organization_code_required" : parsed.error.error,
        message: !organizationCode ? "Organisation code is required." : parsed.error.message,
      });
      return;
    }

    if (findUserByEmail(parsed.email)) {
      sendJson(request, response, 409, {
        error: "email_already_exists",
        message: "An account with that email already exists.",
      });
      return;
    }

    if (findUserByNormalizedUsername(parsed.usernameNormalized)) {
      sendJson(request, response, 409, {
        error: "username_already_exists",
        message: "That username is already taken.",
      });
      return;
    }

    const workspace = findWorkspaceByOrganizationCode(organizationCode);
    if (!workspace) {
      sendJson(request, response, 404, {
        error: "organization_not_found",
        message: "Organisation code was not found.",
      });
      return;
    }

    let membershipSource = "password_organisation_member";
    if (workspace.opsuiLinked) {
      const validation = validateFixtureOpsuiCredentials(parsed.email, parsed.password);
      if (!validation.ok) {
        sendJson(request, response, 403, {
          error: validation.code,
          message: getFixtureOpsuiMessage(validation.code),
        });
        return;
      }

      if (validation.businessId !== workspace.opsuiBusinessId) {
        sendJson(request, response, 403, {
          error: "business_mismatch",
          message: getFixtureOpsuiMessage("business_mismatch"),
        });
        return;
      }

      membershipSource = "opsui_business_member";
    }

    const user = createUser(parsed);
    const membership = createMembership({
      membershipSource,
      role: "participant",
      userId: user.id,
      workspaceId: workspace.id,
    });

    state.users.set(user.id, user);
    state.credentials.set(user.id, {
      hashVersion: "pbkdf2_sha256_v1",
      password: parsed.password,
    });

    const session = createUserSessionFromRecords(user, workspace, membership, "password");
    const token = randomUUID();
    state.authSessions.set(token, session);

    writeCorsHeaders(request, response);
    response.setHeader("Set-Cookie", buildSessionCookie(token));
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, actor: session.actor }));
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
    const subject = "oidc-member-subject";
    const existingUserId = state.externalIdentities.get(`oidc:${subject}`) ?? null;
    if (existingUserId) {
      const user = state.users.get(existingUserId) ?? null;
      const membership = user ? state.memberships.find((entry) => entry.userId === user.id) ?? null : null;
      const workspace = membership ? state.workspaces.get(membership.workspaceId) ?? null : null;
      if (user && membership && workspace) {
        const session = createUserSessionFromRecords(user, workspace, membership, "oidc");
        const token = randomUUID();
        state.authSessions.set(token, session);
        response.setHeader("Set-Cookie", buildSessionCookie(token));
        response.writeHead(302, {
          Location: `${APP_ORIGIN}${redirectTo}`,
        });
        response.end();
        return;
      }
    }

    const pendingToken = randomUUID();
    state.pendingOidcSessions.set(pendingToken, {
      subject,
      email: "oidc.member@example.com",
      firstName: "Oidc",
      lastName: "Member",
      workspaceId: "workspace_local",
      workspaceRole: "owner",
      membershipSource: "oidc_default",
      redirectTo,
    });

    response.setHeader("Set-Cookie", buildPendingOidcCookie(pendingToken));
    response.writeHead(302, {
      Location: `${APP_ORIGIN}/complete-account`,
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
    response.setHeader("Set-Cookie", [
      buildExpiredCookie(),
      buildExpiredCookie(OIDC_PENDING_COOKIE_NAME),
    ]);
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/organisation/me") {
    const session = getCurrentSession(request);
    if (!session.authenticated || session.actor.workspaceKind !== "organisation") {
      sendJson(request, response, 404, {
        error: "organization_not_found",
        message: "No organisation profile is available for this account.",
      });
      return;
    }

    const workspace = state.workspaces.get(session.actor.workspaceId) ?? null;
    if (!workspace || !workspace.organizationCode) {
      sendJson(request, response, 404, {
        error: "organization_not_found",
        message: "No organisation profile is available for this account.",
      });
      return;
    }

    const members = state.memberships
      .filter((membership) => membership.workspaceId === workspace.id)
      .map((membership) => {
        const user = state.users.get(membership.userId);
        if (!user) {
          return null;
        }

        return {
          userId: user.id,
          email: user.email,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: user.displayName,
          workspaceRole: membership.workspaceRole,
          membershipSource: membership.membershipSource,
          joinedAt: membership.createdAt,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.workspaceRole === "owner" && right.workspaceRole !== "owner") {
          return -1;
        }
        if (right.workspaceRole === "owner" && left.workspaceRole !== "owner") {
          return 1;
        }
        return left.displayName.localeCompare(right.displayName);
      });

    sendJson(request, response, 200, {
      members,
      opsuiBusinessId: workspace.opsuiBusinessId,
      opsuiLinked: workspace.opsuiLinked,
      organizationCode: workspace.organizationCode,
      planTier: workspace.planTier,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    });
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
  const createdAt = new Date().toISOString();
  const nextState = {
    authSessions: new Map(),
    credentials: new Map(),
    directMessageMessages: [],
    directMessageThreadMembers: [],
    directMessageThreads: new Map(),
    events: new Map(),
    externalIdentities: new Map(),
    meetings: new Map(),
    memberships: [],
    nextEventNumber: 1,
    nextDirectMessageMessageNumber: 1,
    nextDirectMessageThreadNumber: 1,
    nextMembershipNumber: 1,
    nextMeetingNumber: 1,
    nextParticipantNumber: 1,
    nextRoomNumber: 1,
    nextUserNumber: 1,
    nextWorkspaceNumber: 1,
    pendingOidcSessions: new Map(),
    participants: new Map(),
    recordings: new Map(),
    rooms: new Map(),
    users: new Map(),
    workspaces: new Map(),
  };

  const localWorkspace = {
    id: "workspace_local",
    name: "My Workspace",
    organizationCode: null,
    organizationNameNormalized: null,
    opsuiBusinessId: null,
    opsuiLinked: false,
    planTier: "standard",
    slug: "my-workspace",
    workspaceKind: "personal",
    createdAt,
    updatedAt: createdAt,
  };

  nextState.workspaces.set(localWorkspace.id, localWorkspace);

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
  const workspaceId = typeof input.workspaceId === "string" && input.workspaceId.trim()
    ? input.workspaceId.trim()
    : "workspace_local";
  const room = {
    id: `room_${state.nextRoomNumber++}`,
    workspaceId,
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
      workspaceName: "My Workspace",
      workspaceKind: "personal",
      planTier: "standard",
    },
    authenticated: false,
    provider: "anonymous",
    sessionType: "guest",
  };
}

function createUserSession(email) {
  const trimmedEmail = email.trim() || "member@example.com";
  const workspace = state.workspaces.get("workspace_local");
  const localPart = trimmedEmail.split("@")[0] ?? "member";
  const user = {
    id: `mock_${localPart.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    email: trimmedEmail,
    username: localPart.replace(/[^a-z0-9._]+/gi, "").toLowerCase() || "member",
    usernameNormalized: localPart.replace(/[^a-z0-9._]+/gi, "").toLowerCase() || "member",
    firstName: toDisplayNamePart(localPart),
    lastName: "User",
    displayName: `${toDisplayNamePart(localPart)} User`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const membership = {
    id: `membership_${state.nextMembershipNumber++}`,
    workspaceId: workspace?.id ?? "workspace_local",
    userId: user.id,
    workspaceRole: "owner",
    membershipSource: "mock",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.users.set(user.id, user);
  state.memberships.push(membership);
  return createUserSessionFromRecords(user, workspace ?? {
    id: "workspace_local",
    name: "My Workspace",
    organizationCode: null,
    organizationNameNormalized: null,
    opsuiBusinessId: null,
    opsuiLinked: false,
    planTier: "standard",
    slug: "my-workspace",
    workspaceKind: "personal",
  }, membership, "mock");
}

function createUserSessionFromRecords(user, workspace, membership, provider) {
  return {
    actor: {
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      membershipSource: membership.membershipSource,
      organizationCode: workspace.organizationCode ?? undefined,
      planTier: workspace.planTier,
      userId: user.id,
      workspaceId: workspace.id,
      workspaceKind: workspace.workspaceKind,
      workspaceName: workspace.name,
      workspaceRole: membership.workspaceRole,
    },
    authenticated: true,
    provider,
    sessionType: "user",
  };
}

function parseFixtureIdentity(body) {
  const email = normalizeEmail(body?.email);
  const password = typeof body?.password === "string" ? body.password : "";
  const usernameValidation = validateFixtureUsername(body?.username);
  const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";

  if (!email || !password || !firstName || !lastName) {
    return {
      ok: false,
      error: {
        error: "required_fields_missing",
        message: "Email, username, first name, last name, and password are required.",
      },
    };
  }

  if (!usernameValidation.ok) {
    return {
      ok: false,
      error: {
        error: usernameValidation.error,
        message: usernameValidation.message,
      },
    };
  }

  if (password.length < 8) {
    return {
      ok: false,
      error: {
        error: "password_too_short",
        message: "Password must be at least 8 characters.",
      },
    };
  }

  return {
    ok: true,
    email,
    password,
    username: usernameValidation.username,
    usernameNormalized: usernameValidation.usernameNormalized,
    firstName,
    lastName,
  };
}

function createWorkspace(input) {
  const timestamp = new Date().toISOString();
  const workspace = {
    id: `workspace_${state.nextWorkspaceNumber++}`,
    name: input.name,
    organizationCode: input.organizationCode ?? null,
    organizationNameNormalized: input.organizationNameNormalized ?? null,
    opsuiBusinessId: input.opsuiBusinessId ?? null,
    opsuiLinked: input.opsuiLinked ?? false,
    planTier: input.planTier ?? "standard",
    slug: ensureUniqueWorkspaceSlug(normalizeSlug(input.name || "workspace")),
    workspaceKind: input.workspaceKind ?? "personal",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.workspaces.set(workspace.id, workspace);
  return workspace;
}

function createUser(input) {
  const timestamp = new Date().toISOString();
  return {
    id: `user_${state.nextUserNumber++}`,
    email: input.email,
    username: input.username,
    usernameNormalized: input.usernameNormalized,
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: `${input.firstName} ${input.lastName}`.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createMembership(input) {
  const membership = {
    id: `membership_${state.nextMembershipNumber++}`,
    workspaceId: input.workspaceId,
    userId: input.userId,
    workspaceRole: input.role,
    membershipSource: input.membershipSource,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.memberships.push(membership);
  return membership;
}

function findUserByEmail(email) {
  if (!email) {
    return null;
  }

  for (const user of state.users.values()) {
    if (user.email.toLowerCase() === email) {
      return user;
    }
  }

  return null;
}

function findUserByNormalizedUsername(usernameNormalized) {
  if (!usernameNormalized) {
    return null;
  }

  for (const user of state.users.values()) {
    if (user.usernameNormalized === usernameNormalized) {
      return user;
    }
  }

  return null;
}

function findWorkspaceByOrganizationCode(organizationCode) {
  for (const workspace of state.workspaces.values()) {
    if (workspace.organizationCode?.toUpperCase() === organizationCode.toUpperCase()) {
      return workspace;
    }
  }

  return null;
}

function findWorkspaceByNormalizedOrganizationName(organizationNameNormalized) {
  if (!organizationNameNormalized) {
    return null;
  }

  for (const workspace of state.workspaces.values()) {
    if (
      workspace.workspaceKind === "organisation" &&
      workspace.organizationNameNormalized === organizationNameNormalized
    ) {
      return workspace;
    }
  }

  return null;
}

function getOrCreateFixtureDirectMessageThread(firstUserId, secondUserId) {
  const participantKey = buildFixtureDirectMessageParticipantKey(firstUserId, secondUserId);
  for (const thread of state.directMessageThreads.values()) {
    if (thread.participantKey === participantKey) {
      return thread;
    }
  }

  const now = new Date().toISOString();
  const thread = {
    id: `dm_thread_${state.nextDirectMessageThreadNumber++}`,
    threadKind: "direct",
    participantKey,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    lastMessagePreview: null,
  };
  state.directMessageThreads.set(thread.id, thread);
  state.directMessageThreadMembers.push({
    threadId: thread.id,
    userId: firstUserId,
    joinedAt: now,
    lastReadAt: null,
    lastReadMessageId: null,
  });
  state.directMessageThreadMembers.push({
    threadId: thread.id,
    userId: secondUserId,
    joinedAt: now,
    lastReadAt: null,
    lastReadMessageId: null,
  });
  return thread;
}

function buildFixtureDirectMessageParticipantKey(firstUserId, secondUserId) {
  return [firstUserId, secondUserId].sort((left, right) => left.localeCompare(right)).join(":");
}

function getDirectMessageMembership(threadId, userId) {
  return state.directMessageThreadMembers.find((member) => member.threadId === threadId && member.userId === userId) ?? null;
}

function listDirectMessageMessagesByThread(threadId) {
  return state.directMessageMessages
    .filter((message) => message.threadId === threadId)
    .sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt));
}

function listDirectMessageThreadsForUser(userId) {
  return [...state.directMessageThreads.values()]
    .filter((thread) => getDirectMessageMembership(thread.id, userId))
    .sort((left, right) => {
      const leftAt = Date.parse(left.lastMessageAt ?? left.updatedAt);
      const rightAt = Date.parse(right.lastMessageAt ?? right.updatedAt);
      return rightAt - leftAt;
    })
    .map((thread) => toDirectMessageThreadSummary(thread, userId));
}

function toDirectMessageSearchResult(user) {
  return {
    userId: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
  };
}

function toDirectMessageThreadSummary(thread, currentUserId) {
  return {
    id: thread.id,
    threadKind: "direct",
    participant: getDirectMessageOtherUser(thread.id, currentUserId),
    lastMessagePreview: thread.lastMessagePreview,
    lastMessageAt: thread.lastMessageAt,
    unreadCount: getDirectMessageUnreadCount(thread.id, currentUserId),
    updatedAt: thread.updatedAt,
  };
}

function toDirectMessageThreadDetail(thread, currentUserId) {
  return {
    ...toDirectMessageThreadSummary(thread, currentUserId),
    createdAt: thread.createdAt,
  };
}

function toDirectMessageMessage(message) {
  const sender = state.users.get(message.senderUserId);
  return {
    id: message.id,
    threadId: message.threadId,
    senderUserId: message.senderUserId,
    senderUsername: sender?.username ?? "",
    senderDisplayName: sender?.displayName ?? "Member",
    body: message.body,
    sentAt: message.sentAt,
  };
}

function getDirectMessageOtherUser(threadId, currentUserId) {
  const otherMembership = state.directMessageThreadMembers.find(
    (member) => member.threadId === threadId && member.userId !== currentUserId,
  );
  const otherUser = otherMembership ? state.users.get(otherMembership.userId) ?? null : null;
  if (!otherUser) {
    return {
      userId: otherMembership?.userId ?? "missing",
      username: "unknown",
      firstName: "Unknown",
      lastName: "Member",
      displayName: "Unknown Member",
    };
  }

  return toDirectMessageSearchResult(otherUser);
}

function getDirectMessageUnreadCount(threadId, currentUserId) {
  const membership = getDirectMessageMembership(threadId, currentUserId);
  if (!membership) {
    return 0;
  }

  const messages = listDirectMessageMessagesByThread(threadId);
  if (!messages.length) {
    return 0;
  }

  if (!membership.lastReadMessageId) {
    return messages.filter((message) => message.senderUserId !== currentUserId).length;
  }

  const lastReadIndex = messages.findIndex((message) => message.id === membership.lastReadMessageId);
  if (lastReadIndex === -1) {
    return messages.filter((message) => message.senderUserId !== currentUserId).length;
  }

  return messages.slice(lastReadIndex + 1).filter((message) => message.senderUserId !== currentUserId).length;
}

function createDirectMessagePreview(text) {
  if (text.length <= 120) {
    return text;
  }

  return `${text.slice(0, 119)}…`;
}

function getFixtureUsernameMatchScore(usernameNormalized, query) {
  if (usernameNormalized === query) {
    return 3;
  }

  if (usernameNormalized.startsWith(query)) {
    return 2;
  }

  if (usernameNormalized.includes(query)) {
    return 1;
  }

  return 0;
}

function ensureUniqueWorkspaceSlug(baseSlug) {
  let suffix = 0;
  let candidate = baseSlug;
  const hasMatch = (slug) => {
    for (const workspace of state.workspaces.values()) {
      if (workspace.slug === slug) {
        return true;
      }
    }
    return false;
  };

  while (hasMatch(candidate)) {
    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }

  return candidate;
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeOrganizationName(value) {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function validateFixtureUsername(value) {
  const username = typeof value === "string" ? value.trim() : "";
  if (!username) {
    return {
      ok: false,
      error: "username_required",
      message: "Username is required.",
    };
  }

  if (username.length < 3 || username.length > 24) {
    return {
      ok: false,
      error: "username_invalid_length",
      message: "Username must be between 3 and 24 characters.",
    };
  }

  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._]*[A-Za-z0-9])?$/.test(username)) {
    return {
      ok: false,
      error: "username_invalid_format",
      message: "Usernames may only use letters, numbers, dots, and underscores, and must start and end with a letter or number.",
    };
  }

  return {
    ok: true,
    username,
    usernameNormalized: username.toLowerCase(),
  };
}

function generateFixtureOrganizationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let code = "";
    for (let index = 0; index < 8; index += 1) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }

    if (!findWorkspaceByOrganizationCode(code)) {
      return code;
    }
  }

  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

function validateFixtureOpsuiCredentials(email, password) {
  if (!email || password.toLowerCase().includes("invalid")) {
    return {
      ok: false,
      code: "invalid_credentials",
    };
  }

  const domain = email.split("@")[1] ?? "";
  if (!domain) {
    return {
      ok: false,
      code: "no_business_access",
    };
  }

  return {
    ok: true,
    businessId: domain.toLowerCase(),
    businessName: toDisplayNamePart(domain.split(".")[0] ?? "Business"),
  };
}

function getFixtureOpsuiMessage(code) {
  switch (code) {
    case "invalid_credentials":
      return "Those OpsUI credentials were not accepted.";
    case "no_business_access":
      return "Those OpsUI credentials do not include business access.";
    case "business_mismatch":
      return "Those OpsUI credentials belong to a different business.";
    default:
      return "OpsUI validation is unavailable right now.";
  }
}

function toDisplayNamePart(value) {
  return String(value)
    .replace(/[_.-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Member";
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

function buildPendingOidcCookie(token) {
  return `${OIDC_PENDING_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Max-Age=600; Path=/; SameSite=Lax`;
}

function buildExpiredCookie(name = SESSION_COOKIE_NAME) {
  return `${name}=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax`;
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
    "content-type, idempotency-key, x-idempotency-key, x-user-id, x-user-email, x-workspace-id, x-workspace-role, x-session-type",
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
