import type { RoomPolicy, RoomSummary, TemplateSummary } from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { withIdempotency } from "../lib/idempotency";
import { json } from "../lib/http";
import { optionalBoolean, optionalEnum, parseJson, requireNonEmptyString } from "../lib/request";
import { buildSlug } from "../lib/slug";
import type { Env } from "../types";

const DEFAULT_ROOM_POLICY: RoomPolicy = {
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

export async function createRoom(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<{
    name: string;
    templateId: string;
    isPersistent: boolean;
    roomType: RoomSummary["roomType"];
  }>(request);

  const result = await withIdempotency(request, "rooms.create", async () => {
    const name = requireNonEmptyString(payload.name, "room_name_required", "New OpsUI Room");
    const roomType = optionalEnum(
      payload.roomType,
      ["instant", "scheduled", "recurring", "persistent"] as const,
      "instant",
      "invalid_room_type",
    );
    const workspacePolicy = repositories.policies.getWorkspacePolicy(actor.workspaceId);
    const template =
      typeof payload.templateId === "string"
        ? repositories.templates
            .listByWorkspace(actor.workspaceId)
            .find((item) => item.id === payload.templateId) ?? null
        : null;

    const room: RoomSummary & {
      templateId: string | null;
      isPersistent: boolean;
      createdBy: string;
      createdAt: string;
    } = {
      id: crypto.randomUUID(),
      workspaceId: actor.workspaceId,
      name,
      slug: buildSlug(name),
      templateId: typeof payload.templateId === "string" ? payload.templateId : null,
      roomType,
      isPersistent: optionalBoolean(payload.isPersistent, false),
      policy: buildRoomPolicy(workspacePolicy, template),
      createdBy: actor.userId,
      createdAt: new Date().toISOString(),
    };

    repositories.rooms.create(room);
    repositories.audit.append({
      actor: actor.email ?? actor.userId,
      action: "room.created",
      target: room.name,
    });

    return {
      body: room,
      status: 201,
    };
  });

  await repositories.commit();
  return json(result.body, { status: result.status });
}

export async function listRooms(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const response = json({ items: repositories.rooms.listByWorkspace(actor.workspaceId) });
  await repositories.commit();
  return response;
}

function buildRoomPolicy(
  workspacePolicy: { defaultRoomPolicy: RoomPolicy; guestJoinMode: "open" | "restricted" | "disabled" } | null,
  template: TemplateSummary | null,
): RoomPolicy {
  const basePolicy = workspacePolicy
    ? {
        ...workspacePolicy.defaultRoomPolicy,
        allowGuestJoin: workspacePolicy.guestJoinMode !== "disabled",
      }
    : DEFAULT_ROOM_POLICY;

  if (!template) {
    return basePolicy;
  }

  switch (template.templateType) {
    case "standup":
      return {
        ...basePolicy,
        lobbyEnabled: false,
        mutedOnEntry: true,
        chatMode: "open",
        screenShareMode: "presenters",
      };
    case "sales_demo":
      return {
        ...basePolicy,
        lobbyEnabled: true,
        mutedOnEntry: false,
        chatMode: "open",
        screenShareMode: "presenters",
      };
    case "training":
      return {
        ...basePolicy,
        lobbyEnabled: true,
        mutedOnEntry: true,
        chatMode: "moderated",
        screenShareMode: "presenters",
      };
    case "lecture":
      return {
        ...basePolicy,
        lobbyEnabled: true,
        mutedOnEntry: true,
        chatMode: "host_only",
        screenShareMode: "hosts_only",
      };
    case "webinar":
      return {
        ...basePolicy,
        lobbyEnabled: true,
        mutedOnEntry: true,
        chatMode: "host_only",
        screenShareMode: "presenters",
      };
    default:
      return basePolicy;
  }
}
