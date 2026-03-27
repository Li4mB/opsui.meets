import type { HookDeliveryAttempt } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class HookDeliveriesRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  listRecentByWorkspace(workspaceId: string, limit = 20): HookDeliveryAttempt[] {
    return this.getStore().hookDeliveries
      .filter((attempt) => attempt.workspaceId === workspaceId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit);
  }

  listByMeetingInstance(meetingInstanceId: string, limit = 10): HookDeliveryAttempt[] {
    return this.getStore().hookDeliveries
      .filter((attempt) => attempt.meetingInstanceId === meetingInstanceId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit);
  }

  append(
    input: Omit<HookDeliveryAttempt, "id" | "occurredAt"> & { occurredAt?: string },
  ): HookDeliveryAttempt {
    const attempt: HookDeliveryAttempt = {
      id: crypto.randomUUID(),
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      ...input,
    };

    this.getStore().hookDeliveries.unshift(attempt);
    return attempt;
  }
}
