import { createPostgresRepositoryContext } from "./adapters/postgres";
import { ActionItemsRepository } from "./repositories/action-items";
import { AuditRepository } from "./repositories/audit";
import { DashboardRepository } from "./repositories/dashboard";
import { DirectMessagesRepository } from "./repositories/direct-messages";
import { EventsRepository } from "./repositories/events";
import { ExternalAuthIdentitiesRepository } from "./repositories/external-auth-identities";
import { HookDeliveriesRepository } from "./repositories/hook-deliveries";
import { MeetingsRepository } from "./repositories/meetings";
import { PasswordCredentialsRepository } from "./repositories/password-credentials";
import { ParticipantsRepository } from "./repositories/participants";
import { PoliciesRepository } from "./repositories/policies";
import { RecordingsRepository } from "./repositories/recordings";
import { RoomsRepository } from "./repositories/rooms";
import { TemplatesRepository } from "./repositories/templates";
import { UsersRepository } from "./repositories/users";
import { WorkspaceMembershipsRepository } from "./repositories/workspace-memberships";
import { WorkspacesRepository } from "./repositories/workspaces";
import type { RequestRepositoryContext } from "./contracts";

export type DataMode = "memory" | "postgres";

export interface RepositoryContextOptions {
  connectionString?: string;
  scope?: string;
}

export async function getRepositoryContext(
  mode: DataMode = "memory",
  options: RepositoryContextOptions = {},
): Promise<RequestRepositoryContext> {
  if (mode === "postgres") {
    return createPostgresRepositoryContext(options);
  }

  return {
    workspaces: new WorkspacesRepository(),
    users: new UsersRepository(),
    workspaceMemberships: new WorkspaceMembershipsRepository(),
    passwordCredentials: new PasswordCredentialsRepository(),
    externalAuthIdentities: new ExternalAuthIdentitiesRepository(),
    directMessages: new DirectMessagesRepository(),
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
