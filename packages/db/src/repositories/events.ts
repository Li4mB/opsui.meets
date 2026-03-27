import type { RoomEvent } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class EventsRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  listByMeetingInstance(meetingInstanceId: string): RoomEvent[] {
    return this.getStore().roomEvents.filter((event) => event.meetingInstanceId === meetingInstanceId);
  }

  append(entry: {
    meetingInstanceId: string;
    type: RoomEvent["type"];
    actorParticipantId?: string;
    payload: RoomEvent["payload"];
  }): RoomEvent {
    const store = this.getStore();
    const nextNumber =
      store.roomEvents
        .filter((event) => event.meetingInstanceId === entry.meetingInstanceId)
        .reduce((highest, event) => Math.max(highest, event.roomEventNumber), 0) + 1;

    const event: RoomEvent = {
      eventId: crypto.randomUUID(),
      roomEventNumber: nextNumber,
      meetingInstanceId: entry.meetingInstanceId,
      type: entry.type,
      occurredAt: new Date().toISOString(),
      actorParticipantId: entry.actorParticipantId,
      payload: entry.payload,
    };

    store.roomEvents.unshift(event);
    return event;
  }
}
