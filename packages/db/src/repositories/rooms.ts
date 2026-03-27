import type { RoomRecord } from "../types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class RoomsRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  listByWorkspace(workspaceId: string): RoomRecord[] {
    return this.getStore().rooms.filter((room) => room.workspaceId === workspaceId);
  }

  create(room: RoomRecord): RoomRecord {
    const store = this.getStore();
    store.rooms.unshift(room);
    return room;
  }

  getById(id: string): RoomRecord | null {
    return this.getStore().rooms.find((room) => room.id === id) ?? null;
  }

  getBySlug(slug: string): RoomRecord | null {
    return this.getStore().rooms.find((room) => room.slug === slug) ?? null;
  }
}
