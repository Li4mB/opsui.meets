import { createPostgresRepositoryContext } from "./adapters/postgres";
import { ActionItemsRepository } from "./repositories/action-items";
import { AuditRepository } from "./repositories/audit";
import { DashboardRepository } from "./repositories/dashboard";
import { EventsRepository } from "./repositories/events";
import { HookDeliveriesRepository } from "./repositories/hook-deliveries";
import { MeetingsRepository } from "./repositories/meetings";
import { ParticipantsRepository } from "./repositories/participants";
import { PoliciesRepository } from "./repositories/policies";
import { RecordingsRepository } from "./repositories/recordings";
import { RoomsRepository } from "./repositories/rooms";
import { TemplatesRepository } from "./repositories/templates";
import type { RequestRepositoryContext } from "./contracts";

export type DataMode = "memory" | "postgres";

export interface RepositoryContextOptions {
  connectionString?: string;
}

export async function getRepositoryContext(
  mode: DataMode = "memory",
  options: RepositoryContextOptions = {},
): Promise<RequestRepositoryContext> {
  if (mode === "postgres") {
    return createPostgresRepositoryContext(options);
  }

  return {
    rooms: new RoomsRepository(),
    meetings: new MeetingsRepository(),
    participants: new ParticipantsRepository(),
    recordings: new RecordingsRepository(),
    templates: new TemplatesRepository(),
    actionItems: new ActionItemsRepository(),
    policies: new PoliciesRepository(),
    hookDeliveries: new HookDeliveriesRepository(),
    dashboard: new DashboardRepository(),
    audit: new AuditRepository(),
    events: new EventsRepository(),
    async commit(): Promise<void> {
      return;
    },
  };
}
