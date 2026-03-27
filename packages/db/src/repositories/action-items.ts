import type { ActionItem, CreateActionItemInput } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class ActionItemsRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  listByMeetingInstance(meetingInstanceId: string): ActionItem[] {
    return this.getStore().actionItems.filter((item) => item.meetingInstanceId === meetingInstanceId);
  }

  create(meetingInstanceId: string, input: CreateActionItemInput): ActionItem {
    const actionItem: ActionItem = {
      id: crypto.randomUUID(),
      meetingInstanceId,
      sourceType: "manual",
      title: input.title,
      ownerLabel: input.ownerLabel,
      dueAt: input.dueAt,
      status: "open",
      createdAt: new Date().toISOString(),
    };

    this.getStore().actionItems.unshift(actionItem);
    return actionItem;
  }

  complete(meetingInstanceId: string, actionItemId: string): ActionItem | null {
    const actionItem =
      this.getStore().actionItems.find(
        (item) => item.meetingInstanceId === meetingInstanceId && item.id === actionItemId,
      ) ?? null;

    if (!actionItem) {
      return null;
    }

    actionItem.status = "done";
    return actionItem;
  }
}
