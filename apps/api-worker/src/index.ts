import * as Sentry from "@sentry/cloudflare";
import { recordApiMetric } from "./lib/analytics";
import { assertPersistenceAvailable } from "./lib/data-status";
import { getSentryOptions } from "./lib/sentry";
import { completeActionItem, createActionItem, listActionItems } from "./routes/action-items";
import { sendChatMessage } from "./routes/chat";
import { dispatchFollowUp } from "./routes/follow-up-dispatch";
import { retryFollowUp } from "./routes/follow-up-retry";
import { exportFollowUp } from "./routes/follow-up-export";
import { listFollowUpAttempts } from "./routes/follow-up-attempts";
import { getAdminAudit } from "./routes/admin-audit";
import { getAdminHookDeliveries } from "./routes/admin-hook-deliveries";
import { retryAdminHookFailures } from "./routes/admin-hook-retry-failures";
import { exportAttendance } from "./routes/attendance-export";
import { getDashboard, getAdminOverview } from "./routes/dashboard";
import {
  createOrGetDirectMessageThread,
  getDirectMessageThread,
  listDirectMessageMessages,
  listDirectMessageThreads,
  markDirectMessageThreadRead,
  searchDirectMessageUsers,
  sendDirectMessage,
} from "./routes/direct-messages";
import { listRoomEvents } from "./routes/events";
import { getMeetingDetail } from "./routes/meeting-detail";
import { createMeetingMediaSession } from "./routes/media-session";
import { getHealth } from "./routes/health";
import { joinMeeting } from "./routes/join";
import { createMeeting, listMeetings } from "./routes/meetings";
import { getMeetingRecording } from "./routes/meeting-recording";
import { getMeetingSummary } from "./routes/meeting-summary";
import {
  admitParticipant,
  endMeeting,
  leaveParticipant,
  lockMeeting,
  muteAllParticipants,
  removeParticipant,
  unlockMeeting,
} from "./routes/moderation";
import { listParticipants } from "./routes/participants";
import { touchParticipantSession } from "./routes/participants";
import { testPostMeetingHook } from "./routes/post-meeting-hook-test";
import { getWorkspacePolicy, updateWorkspacePolicy } from "./routes/policies";
import { resolveRoom } from "./routes/room-resolve";
import { getRoomState } from "./routes/room-state";
import { startRecording, stopRecording } from "./routes/recordings";
import { createRoom, listRooms } from "./routes/rooms";
import { createTemplate } from "./routes/templates-create";
import { listTemplates } from "./routes/templates";
import type { Env } from "./types";
import { ApiError, fromApiError, internalError, notFound } from "./lib/http";
import { getMeetingRecordingAction } from "./lib/paths";
import { handleCorsPreflight, withCors } from "./lib/cors";
import {
  getMeetingActionItemCompletePath,
  getMeetingActionItemsPath,
  getMeetingAttendanceExportPath,
  getMeetingChatMessagesPath,
  getDirectMessageThreadMessagesPath,
  getDirectMessageThreadPath,
  getDirectMessageThreadReadPath,
  getMeetingFollowUpAttemptsPath,
  getMeetingFollowUpDispatchPath,
  getMeetingFollowUpExportPath,
  getMeetingFollowUpRetryPath,
  getMeetingParticipantsPath,
  getMeetingParticipantHeartbeatPath,
  getMeetingEventsPath,
  getMeetingEndPath,
  getMeetingLockPath,
  getMeetingMuteAllPath,
  getMeetingParticipantModerationPath,
  getMeetingRecordingPath,
  getMeetingDetailPath,
  getMeetingJoinPath,
  getMeetingMediaSessionPath,
  getMeetingSummaryPath,
  getMeetingUnlockPath,
  getRoomResolvePath,
  getRoomStatePath,
} from "./lib/route-params";

export default Sentry.withSentry<Env>((env) => getSentryOptions(env), {
  async fetch(request: Request, env: Env): Promise<Response> {
    let routePath = "unknown";
    try {
      const url = new URL(request.url);
      routePath = url.pathname;
      const preflight = handleCorsPreflight(request);
      if (preflight) {
        return preflight;
      }

      let routeResponse: Response;

      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
        routeResponse = getHealth(request, env);
        return withCors(routeResponse, request);
      }

      assertPersistenceAvailable(env);

      if (request.method === "GET" && url.pathname === "/v1/dashboard") {
        routeResponse = await getDashboard(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET" && url.pathname === "/v1/direct-messages/threads") {
        routeResponse = await listDirectMessageThreads(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET" && url.pathname === "/v1/direct-messages/search") {
        routeResponse = await searchDirectMessageUsers(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "POST" && url.pathname === "/v1/direct-messages/threads") {
        routeResponse = await createOrGetDirectMessageThread(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET" && url.pathname === "/v1/policies/workspace") {
        routeResponse = await getWorkspacePolicy(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "PATCH" && url.pathname === "/v1/policies/workspace") {
        routeResponse = await updateWorkspacePolicy(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "POST" && url.pathname === "/v1/policies/workspace/post-meeting-hook/test") {
        routeResponse = await testPostMeetingHook(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/analytics/overview") {
        routeResponse = await getAdminOverview(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/audit") {
        routeResponse = await getAdminAudit(env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/hooks/deliveries") {
        routeResponse = await getAdminHookDeliveries(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/hooks/retry-failures") {
        routeResponse = await retryAdminHookFailures(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET") {
        const roomStatePath = getRoomStatePath(url.pathname);
        if (roomStatePath) {
          routeResponse = await getRoomState(roomStatePath.slug, env);
          return withCors(routeResponse, request);
        }

        const roomResolvePath = getRoomResolvePath(url.pathname);
        if (roomResolvePath) {
          routeResponse = await resolveRoom(roomResolvePath.slug, env);
          return withCors(routeResponse, request);
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/rooms") {
        routeResponse = await createRoom(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET" && url.pathname === "/v1/rooms") {
        routeResponse = await listRooms(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET" && url.pathname === "/v1/templates") {
        routeResponse = await listTemplates(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "POST" && url.pathname === "/v1/templates") {
        routeResponse = await createTemplate(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "POST" && url.pathname === "/v1/meetings") {
        routeResponse = await createMeeting(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET" && url.pathname === "/v1/meetings") {
        routeResponse = await listMeetings(request, env);
        return withCors(routeResponse, request);
      }

      if (request.method === "GET") {
        const directMessageThreadPath = getDirectMessageThreadPath(url.pathname);
        if (directMessageThreadPath) {
          routeResponse = await getDirectMessageThread(request, directMessageThreadPath.threadId, env);
          return withCors(routeResponse, request);
        }

        const directMessageMessagesPath = getDirectMessageThreadMessagesPath(url.pathname);
        if (directMessageMessagesPath) {
          routeResponse = await listDirectMessageMessages(request, directMessageMessagesPath.threadId, env);
          return withCors(routeResponse, request);
        }

        const detailPath = getMeetingDetailPath(url.pathname);
        if (detailPath) {
          routeResponse = await getMeetingDetail(detailPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const attendanceExportPath = getMeetingAttendanceExportPath(url.pathname);
        if (attendanceExportPath) {
          routeResponse = await exportAttendance(attendanceExportPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const followUpExportPath = getMeetingFollowUpExportPath(url.pathname);
        if (followUpExportPath) {
          routeResponse = await exportFollowUp(request, followUpExportPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const followUpAttemptsPath = getMeetingFollowUpAttemptsPath(url.pathname);
        if (followUpAttemptsPath) {
          routeResponse = await listFollowUpAttempts(followUpAttemptsPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const actionItemsPath = getMeetingActionItemsPath(url.pathname);
        if (actionItemsPath) {
          routeResponse = await listActionItems(actionItemsPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const recordingPath = getMeetingRecordingPath(url.pathname);
        if (recordingPath) {
          routeResponse = await getMeetingRecording(recordingPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const eventsPath = getMeetingEventsPath(url.pathname);
        if (eventsPath) {
          routeResponse = await listRoomEvents(eventsPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const participantsPath = getMeetingParticipantsPath(url.pathname);
        if (participantsPath) {
          routeResponse = await listParticipants(participantsPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const summaryPath = getMeetingSummaryPath(url.pathname);
        if (summaryPath) {
          routeResponse = await getMeetingSummary(summaryPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }
      }

      if (request.method === "POST") {
        const directMessageReadPath = getDirectMessageThreadReadPath(url.pathname);
        if (directMessageReadPath) {
          routeResponse = await markDirectMessageThreadRead(request, directMessageReadPath.threadId, env);
          return withCors(routeResponse, request);
        }

        const directMessageMessagesPath = getDirectMessageThreadMessagesPath(url.pathname);
        if (directMessageMessagesPath) {
          routeResponse = await sendDirectMessage(request, directMessageMessagesPath.threadId, env);
          return withCors(routeResponse, request);
        }

        const heartbeatPath = getMeetingParticipantHeartbeatPath(url.pathname);
        if (heartbeatPath) {
          routeResponse = await touchParticipantSession(
            request,
            heartbeatPath.meetingInstanceId,
            heartbeatPath.participantId,
            env,
          );
          return withCors(routeResponse, request);
        }

        const joinPath = getMeetingJoinPath(url.pathname);
        if (joinPath) {
          routeResponse = await joinMeeting(request, joinPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const chatMessagesPath = getMeetingChatMessagesPath(url.pathname);
        if (chatMessagesPath) {
          routeResponse = await sendChatMessage(request, chatMessagesPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const actionItemsPath = getMeetingActionItemsPath(url.pathname);
        if (actionItemsPath) {
          routeResponse = await createActionItem(request, actionItemsPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const actionItemCompletePath = getMeetingActionItemCompletePath(url.pathname);
        if (actionItemCompletePath) {
          routeResponse = await completeActionItem(
            request,
            actionItemCompletePath.meetingInstanceId,
            actionItemCompletePath.actionItemId,
            env,
          );
          return withCors(routeResponse, request);
        }

        const followUpDispatchPath = getMeetingFollowUpDispatchPath(url.pathname);
        if (followUpDispatchPath) {
          routeResponse = await dispatchFollowUp(request, followUpDispatchPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const followUpRetryPath = getMeetingFollowUpRetryPath(url.pathname);
        if (followUpRetryPath) {
          routeResponse = await retryFollowUp(request, followUpRetryPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const muteAllPath = getMeetingMuteAllPath(url.pathname);
        if (muteAllPath) {
          routeResponse = await muteAllParticipants(request, muteAllPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const endPath = getMeetingEndPath(url.pathname);
        if (endPath) {
          routeResponse = await endMeeting(request, endPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const lockPath = getMeetingLockPath(url.pathname);
        if (lockPath) {
          routeResponse = await lockMeeting(request, lockPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const unlockPath = getMeetingUnlockPath(url.pathname);
        if (unlockPath) {
          routeResponse = await unlockMeeting(request, unlockPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const participantModerationPath = getMeetingParticipantModerationPath(url.pathname);
        if (participantModerationPath?.action === "admit") {
          routeResponse = await admitParticipant(
            request,
            participantModerationPath.meetingInstanceId,
            participantModerationPath.participantId,
            env,
          );
          return withCors(routeResponse, request);
        }

        if (participantModerationPath?.action === "remove") {
          routeResponse = await removeParticipant(
            request,
            participantModerationPath.meetingInstanceId,
            participantModerationPath.participantId,
            env,
          );
          return withCors(routeResponse, request);
        }

        if (participantModerationPath?.action === "leave") {
          routeResponse = await leaveParticipant(
            request,
            participantModerationPath.meetingInstanceId,
            participantModerationPath.participantId,
            env,
          );
          return withCors(routeResponse, request);
        }

        const recordingAction = getMeetingRecordingAction(url.pathname);
        if (recordingAction?.action === "start") {
          routeResponse = await startRecording(request, recordingAction.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        if (recordingAction?.action === "stop") {
          routeResponse = await stopRecording(request, recordingAction.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }

        const mediaSessionPath = getMeetingMediaSessionPath(url.pathname);
        if (mediaSessionPath) {
          routeResponse = await createMeetingMediaSession(request, mediaSessionPath.meetingInstanceId, env);
          return withCors(routeResponse, request);
        }
      }

      const response = notFound();
      recordApiMetric(env, {
        route: "not-found",
        status: response.status,
        request,
        outcome: "not_found",
      });
      return withCors(response, request);
    } catch (error) {
      if (error instanceof ApiError) {
        const response = fromApiError(error);
        recordApiMetric(env, {
          route: "api-error",
          status: response.status,
          request,
          outcome: error.code,
        });
        return withCors(response, request);
      }

      console.error("Unhandled API worker error", error);
      Sentry.withScope((scope) => {
        scope.setTag("service", "opsui-meets-api");
        scope.setTag("route", routePath);
        scope.setContext("request", {
          method: request.method,
          path: routePath,
        });
        Sentry.captureException(error);
      });
      const response = internalError();
      recordApiMetric(env, {
        route: "internal-error",
        status: response.status,
        request,
        outcome: "internal_error",
      });
      return withCors(response, request);
    }
  },
} satisfies ExportedHandler<Env>);
