import type { AuditLogEntry } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class AuditRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  listRecent(limit = 10): AuditLogEntry[] {
    return this.getStore().auditLogs.slice(0, limit);
  }

  append(entry: { actor: string; action: string; target: string; occurredAt?: string }): AuditLogEntry {
    const nextEntry: AuditLogEntry = {
      id: crypto.randomUUID(),
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      occurredAt: entry.occurredAt ?? new Date().toISOString(),
    };

    const store = this.getStore();
    store.auditLogs.unshift(nextEntry);
    return nextEntry;
  }
}
