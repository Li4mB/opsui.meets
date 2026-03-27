import type { CreateActionItemInput } from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { withIdempotency } from "../lib/idempotency";
import { ApiError, json } from "../lib/http";
import { syncMeetingSummary } from "../lib/meeting-summary";
import { parseJson, requireNonEmptyString } from "../lib/request";
import type { Env } from "../types";

export async function listActionItems(meetingInstanceId: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.getById(meetingInstanceId);

  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  const response = json({ items: repositories.actionItems.listByMeetingInstance(meetingInstanceId) });
  await repositories.commit();
  return response;
}

export async function createActionItem(
  request: Request,
  meetingInstanceId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<CreateActionItemInput>(request);
  const meeting = repositories.meetings.getById(meetingInstanceId);

  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  const result = await withIdempotency(request, "action-items.create", async () => {
    const actionItem = repositories.actionItems.create(meetingInstanceId, {
      title: requireNonEmptyString(payload.title, "action_item_title_required"),
      ownerLabel:
        typeof payload.ownerLabel === "string" && payload.ownerLabel.trim()
          ? payload.ownerLabel.trim()
          : undefined,
      dueAt: parseOptionalDueAt(payload.dueAt),
    });

    repositories.events.append({
      meetingInstanceId,
      type: "action_item.created",
      payload: {
        title: actionItem.title,
        ownerLabel: actionItem.ownerLabel ?? null,
      },
    });
    repositories.audit.append({
      actor: actor.email ?? actor.userId,
      action: "action_item.created",
      target: `${meeting.title}: ${actionItem.title}`,
    });
    syncMeetingSummary(repositories, meetingInstanceId);

    return {
      body: actionItem,
      status: 201,
    };
  });

  await repositories.commit();
  return json(result.body, { status: result.status });
}

export async function completeActionItem(
  request: Request,
  meetingInstanceId: string,
  actionItemId: string,
  env: Env,
): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.getById(meetingInstanceId);

  if (!meeting) {
    throw new ApiError(404, "meeting_not_found");
  }

  const result = await withIdempotency(request, "action-items.complete", async () => {
    const actionItem = repositories.actionItems.complete(meetingInstanceId, actionItemId);

    if (!actionItem) {
      throw new ApiError(404, "action_item_not_found");
    }

    repositories.events.append({
      meetingInstanceId,
      type: "action_item.completed",
      payload: {
        title: actionItem.title,
      },
    });
    repositories.audit.append({
      actor: actor.email ?? actor.userId,
      action: "action_item.completed",
      target: `${meeting.title}: ${actionItem.title}`,
    });
    syncMeetingSummary(repositories, meetingInstanceId);

    return {
      body: actionItem,
      status: 200,
    };
  });

  await repositories.commit();
  return json(result.body, { status: result.status });
}

function parseOptionalDueAt(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new ApiError(400, "invalid_action_item_due_at");
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new ApiError(400, "invalid_action_item_due_at");
  }

  return new Date(timestamp).toISOString();
}
