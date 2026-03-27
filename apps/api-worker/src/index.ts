import { recordApiMetric } from "./lib/analytics";
import { assertPersistenceAvailable } from "./lib/data-status";
import { completeActionItem, createActionItem, listActionItems } from "./routes/action-items";
import { dispatchFollowUp } from "./routes/follow-up-dispatch";
import { retryFollowUp } from "./routes/follow-up-retry";
import { exportFollowUp } from "./routes/follow-up-export";
import { listFollowUpAttempts } from "./routes/follow-up-attempts";
import { getAdminAudit } from "./routes/admin-audit";
import { getAdminHookDeliveries } from "./routes/admin-hook-deliveries";
import { retryAdminHookFailures } from "./routes/admin-hook-retry-failures";
import { exportAttendance } from "./routes/attendance-export";
import { getDashboard, getAdminOverview } from "./routes/dashboard";
import { listRoomEvents } from "./routes/events";
import { getMeetingDetail } from "./routes/meeting-detail";
import { createMeetingMediaSession } from "./routes/media-session";
import { getHealth } from "./routes/health";
import { joinMeeting } from "./routes/join";
import { createMeeting, listMeetings } from "./routes/meetings";
import { getMeetingRecording } from "./routes/meeting-recording";
import { getMeetingSummary } from "./routes/meeting-summary";
import { admitParticipant, endMeeting, lockMeeting, muteAllParticipants, removeParticipant, unlockMeeting } from "./routes/moderation";
import { listParticipants } from "./routes/participants";
import { testPostMeetingHook } from "./routes/post-meeting-hook-test";
import { getWorkspacePolicy, updateWorkspacePolicy } from "./routes/policies";
import { resolveRoom } from "./routes/room-resolve";
import { startRecording, stopRecording } from "./routes/recordings";
import { createRoom, listRooms } from "./routes/rooms";
import { createTemplate } from "./routes/templates-create";
import { listTemplates } from "./routes/templates";
import type { Env } from "./types";
import { ApiError, fromApiError, internalError, notFound } from "./lib/http";
import { getMeetingRecordingAction } from "./lib/paths";
import {
  getMeetingActionItemCompletePath,
  getMeetingActionItemsPath,
  getMeetingAttendanceExportPath,
  getMeetingFollowUpAttemptsPath,
  getMeetingFollowUpDispatchPath,
  getMeetingFollowUpExportPath,
  getMeetingFollowUpRetryPath,
  getMeetingParticipantsPath,
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
} from "./lib/route-params";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
        return getHealth(request, env);
      }

      assertPersistenceAvailable(env);

      if (request.method === "GET" && url.pathname === "/v1/dashboard") {
        return getDashboard(request, env);
      }

      if (request.method === "GET" && url.pathname === "/v1/policies/workspace") {
        return getWorkspacePolicy(request, env);
      }

      if (request.method === "PATCH" && url.pathname === "/v1/policies/workspace") {
        return updateWorkspacePolicy(request, env);
      }

      if (request.method === "POST" && url.pathname === "/v1/policies/workspace/post-meeting-hook/test") {
        return testPostMeetingHook(request, env);
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/analytics/overview") {
        return getAdminOverview(request, env);
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/audit") {
        return getAdminAudit(env);
      }

      if (request.method === "GET" && url.pathname === "/v1/admin/hooks/deliveries") {
        return getAdminHookDeliveries(request, env);
      }

      if (request.method === "POST" && url.pathname === "/v1/admin/hooks/retry-failures") {
        return retryAdminHookFailures(request, env);
      }

      if (request.method === "GET") {
        const roomResolvePath = getRoomResolvePath(url.pathname);
        if (roomResolvePath) {
          return resolveRoom(roomResolvePath.slug, env);
        }
      }

      if (request.method === "POST" && url.pathname === "/v1/rooms") {
        return createRoom(request, env);
      }

      if (request.method === "GET" && url.pathname === "/v1/rooms") {
        return listRooms(request, env);
      }

      if (request.method === "GET" && url.pathname === "/v1/templates") {
        return listTemplates(request, env);
      }

      if (request.method === "POST" && url.pathname === "/v1/templates") {
        return createTemplate(request, env);
      }

      if (request.method === "POST" && url.pathname === "/v1/meetings") {
        return createMeeting(request, env);
      }

      if (request.method === "GET" && url.pathname === "/v1/meetings") {
        return listMeetings(request, env);
      }

      if (request.method === "GET") {
        const detailPath = getMeetingDetailPath(url.pathname);
        if (detailPath) {
          return getMeetingDetail(detailPath.meetingInstanceId, env);
        }

        const attendanceExportPath = getMeetingAttendanceExportPath(url.pathname);
        if (attendanceExportPath) {
          return exportAttendance(attendanceExportPath.meetingInstanceId, env);
        }

        const followUpExportPath = getMeetingFollowUpExportPath(url.pathname);
        if (followUpExportPath) {
          return exportFollowUp(request, followUpExportPath.meetingInstanceId, env);
        }

        const followUpAttemptsPath = getMeetingFollowUpAttemptsPath(url.pathname);
        if (followUpAttemptsPath) {
          return listFollowUpAttempts(followUpAttemptsPath.meetingInstanceId, env);
        }

        const actionItemsPath = getMeetingActionItemsPath(url.pathname);
        if (actionItemsPath) {
          return listActionItems(actionItemsPath.meetingInstanceId, env);
        }

        const recordingPath = getMeetingRecordingPath(url.pathname);
        if (recordingPath) {
          return getMeetingRecording(recordingPath.meetingInstanceId, env);
        }

        const eventsPath = getMeetingEventsPath(url.pathname);
        if (eventsPath) {
          return listRoomEvents(eventsPath.meetingInstanceId, env);
        }

        const participantsPath = getMeetingParticipantsPath(url.pathname);
        if (participantsPath) {
          return listParticipants(participantsPath.meetingInstanceId, env);
        }

        const summaryPath = getMeetingSummaryPath(url.pathname);
        if (summaryPath) {
          return getMeetingSummary(summaryPath.meetingInstanceId, env);
        }
      }

      if (request.method === "POST") {
        const joinPath = getMeetingJoinPath(url.pathname);
        if (joinPath) {
          return joinMeeting(request, joinPath.meetingInstanceId, env);
        }

        const actionItemsPath = getMeetingActionItemsPath(url.pathname);
        if (actionItemsPath) {
          return createActionItem(request, actionItemsPath.meetingInstanceId, env);
        }

        const actionItemCompletePath = getMeetingActionItemCompletePath(url.pathname);
        if (actionItemCompletePath) {
          return completeActionItem(
            request,
            actionItemCompletePath.meetingInstanceId,
            actionItemCompletePath.actionItemId,
            env,
          );
        }

        const followUpDispatchPath = getMeetingFollowUpDispatchPath(url.pathname);
        if (followUpDispatchPath) {
          return dispatchFollowUp(request, followUpDispatchPath.meetingInstanceId, env);
        }

        const followUpRetryPath = getMeetingFollowUpRetryPath(url.pathname);
        if (followUpRetryPath) {
          return retryFollowUp(request, followUpRetryPath.meetingInstanceId, env);
        }

        const muteAllPath = getMeetingMuteAllPath(url.pathname);
        if (muteAllPath) {
          return muteAllParticipants(request, muteAllPath.meetingInstanceId, env);
        }

        const endPath = getMeetingEndPath(url.pathname);
        if (endPath) {
          return endMeeting(request, endPath.meetingInstanceId, env);
        }

        const lockPath = getMeetingLockPath(url.pathname);
        if (lockPath) {
          return lockMeeting(request, lockPath.meetingInstanceId, env);
        }

        const unlockPath = getMeetingUnlockPath(url.pathname);
        if (unlockPath) {
          return unlockMeeting(request, unlockPath.meetingInstanceId, env);
        }

        const participantModerationPath = getMeetingParticipantModerationPath(url.pathname);
        if (participantModerationPath?.action === "admit") {
          return admitParticipant(
            request,
            participantModerationPath.meetingInstanceId,
            participantModerationPath.participantId,
            env,
          );
        }

        if (participantModerationPath?.action === "remove") {
          return removeParticipant(
            request,
            participantModerationPath.meetingInstanceId,
            participantModerationPath.participantId,
            env,
          );
        }

        const recordingAction = getMeetingRecordingAction(url.pathname);
        if (recordingAction?.action === "start") {
          return startRecording(request, recordingAction.meetingInstanceId, env);
        }

        if (recordingAction?.action === "stop") {
          return stopRecording(request, recordingAction.meetingInstanceId, env);
        }

        const mediaSessionPath = getMeetingMediaSessionPath(url.pathname);
        if (mediaSessionPath) {
          return createMeetingMediaSession(request, mediaSessionPath.meetingInstanceId, env);
        }
      }

      const response = notFound();
      recordApiMetric(env, {
        route: "not-found",
        status: response.status,
        request,
        outcome: "not_found",
      });
      return response;
    } catch (error) {
      if (error instanceof ApiError) {
        const response = fromApiError(error);
        recordApiMetric(env, {
          route: "api-error",
          status: response.status,
          request,
          outcome: error.code,
        });
        return response;
      }

      const response = internalError();
      recordApiMetric(env, {
        route: "internal-error",
        status: response.status,
        request,
        outcome: "internal_error",
      });
      return response;
    }
  },
};
