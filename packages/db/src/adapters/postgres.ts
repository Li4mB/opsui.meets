import postgres from "postgres";
import { ActionItemsRepository } from "../repositories/action-items";
import { AuditRepository } from "../repositories/audit";
import { DashboardRepository } from "../repositories/dashboard";
import { DirectMessagesRepository } from "../repositories/direct-messages";
import { EventsRepository } from "../repositories/events";
import { ExternalAuthIdentitiesRepository } from "../repositories/external-auth-identities";
import { HookDeliveriesRepository } from "../repositories/hook-deliveries";
import { MeetingsRepository } from "../repositories/meetings";
import { PasswordCredentialsRepository } from "../repositories/password-credentials";
import { ParticipantsRepository } from "../repositories/participants";
import { PoliciesRepository } from "../repositories/policies";
import { RecordingsRepository } from "../repositories/recordings";
import { RoomsRepository } from "../repositories/rooms";
import { TemplatesRepository } from "../repositories/templates";
import { UsersRepository } from "../repositories/users";
import { WorkspaceMembershipsRepository } from "../repositories/workspace-memberships";
import { WorkspacesRepository } from "../repositories/workspaces";
import type { RequestRepositoryContext } from "../contracts";
import { compactRuntimeStore, createSeedStore, hydrateMemoryStore, type MemoryStore } from "../store";

const DEFAULT_SCOPE = "global";

interface PersistedRuntimeStateRow {
  version: number | string;
  state: MemoryStore | string;
}

interface PostgresRepositoryContextOptions {
  connectionString?: string;
  scope?: string;
}

type MutationName =
  | "workspaces.create"
  | "users.create"
  | "users.update"
  | "workspaceMemberships.create"
  | "passwordCredentials.upsert"
  | "externalAuthIdentities.create"
  | "directMessages.createThread"
  | "directMessages.addThreadMember"
  | "directMessages.updateThread"
  | "directMessages.createMessage"
  | "directMessages.createAttachment"
  | "directMessages.updateAttachment"
  | "directMessages.markThreadRead"
  | "rooms.create"
  | "meetings.create"
  | "meetings.initializeSummary"
  | "meetings.updateSummary"
  | "meetings.setStatus"
  | "meetings.setLockState"
  | "participants.registerJoin"
  | "participants.admitToMeeting"
  | "participants.leaveMeeting"
  | "participants.removeFromMeeting"
  | "participants.muteAll"
  | "participants.endMeeting"
  | "recordings.upsert"
  | "recordings.updateSaved"
  | "recordings.deleteById"
  | "recordings.pruneExpired"
  | "templates.create"
  | "actionItems.create"
  | "actionItems.complete"
  | "policies.updateWorkspacePolicy"
  | "hookDeliveries.append"
  | "audit.append"
  | "events.append";

interface MutationRecord {
  name: MutationName;
  args: any[];
}

type MutationFn = (...args: any[]) => any;
export type SqlClient = ReturnType<typeof postgres>;

export async function createPostgresRepositoryContext(
  options: PostgresRepositoryContextOptions = {},
): Promise<RequestRepositoryContext> {
  const connectionString = options.connectionString?.trim();
  const scope = options.scope?.trim() || DEFAULT_SCOPE;
  if (!connectionString) {
    throw new Error("Postgres adapter requires DATABASE_URL when APP_DATA_MODE=postgres.");
  }

  const sql = createSqlClient(connectionString);
  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) {
      return;
    }

    disposed = true;
    await sql.end({ timeout: 5 }).catch(() => undefined);
  };

  let persisted: { version: number; store: MemoryStore };
  try {
    persisted = await loadRuntimeState(sql, scope);
  } catch (error) {
    await dispose();
    throw error;
  }

  const getStore = () => persisted.store;
  let dirty = compactRuntimeStore(persisted.store);
  const mutationLog: MutationRecord[] = [];

  const workspaces = new WorkspacesRepository(getStore);
  const users = new UsersRepository(getStore);
  const workspaceMemberships = new WorkspaceMembershipsRepository(getStore);
  const passwordCredentials = new PasswordCredentialsRepository(getStore);
  const externalAuthIdentities = new ExternalAuthIdentitiesRepository(getStore);
  const directMessages = new DirectMessagesRepository(getStore);
  const rooms = new RoomsRepository(getStore);
  const meetings = new MeetingsRepository(getStore);
  const participants = new ParticipantsRepository(getStore);
  const recordings = new RecordingsRepository(getStore);
  const templates = new TemplatesRepository(getStore);
  const actionItems = new ActionItemsRepository(getStore);
  const policies = new PoliciesRepository(getStore);
  const hookDeliveries = new HookDeliveriesRepository(getStore);
  const dashboard = new DashboardRepository(getStore);
  const audit = new AuditRepository(getStore);
  const events = new EventsRepository(getStore);

  const rawMutations: Record<MutationName, MutationFn> = {
    "workspaces.create": workspaces.create.bind(workspaces),
    "users.create": users.create.bind(users),
    "users.update": users.update.bind(users),
    "workspaceMemberships.create": workspaceMemberships.create.bind(workspaceMemberships),
    "passwordCredentials.upsert": passwordCredentials.upsert.bind(passwordCredentials),
    "externalAuthIdentities.create": externalAuthIdentities.create.bind(externalAuthIdentities),
    "directMessages.createThread": directMessages.createThread.bind(directMessages),
    "directMessages.addThreadMember": directMessages.addThreadMember.bind(directMessages),
    "directMessages.updateThread": directMessages.updateThread.bind(directMessages),
    "directMessages.createMessage": directMessages.createMessage.bind(directMessages),
    "directMessages.createAttachment": directMessages.createAttachment.bind(directMessages),
    "directMessages.updateAttachment": directMessages.updateAttachment.bind(directMessages),
    "directMessages.markThreadRead": directMessages.markThreadRead.bind(directMessages),
    "rooms.create": rooms.create.bind(rooms),
    "meetings.create": meetings.create.bind(meetings),
    "meetings.initializeSummary": meetings.initializeSummary.bind(meetings),
    "meetings.updateSummary": meetings.updateSummary.bind(meetings),
    "meetings.setStatus": meetings.setStatus.bind(meetings),
    "meetings.setLockState": meetings.setLockState.bind(meetings),
    "participants.registerJoin": participants.registerJoin.bind(participants),
    "participants.admitToMeeting": participants.admitToMeeting.bind(participants),
    "participants.leaveMeeting": participants.leaveMeeting.bind(participants),
    "participants.removeFromMeeting": participants.removeFromMeeting.bind(participants),
    "participants.muteAll": participants.muteAll.bind(participants),
    "participants.endMeeting": participants.endMeeting.bind(participants),
    "recordings.upsert": recordings.upsert.bind(recordings),
    "recordings.updateSaved": recordings.updateSaved.bind(recordings),
    "recordings.deleteById": recordings.deleteById.bind(recordings),
    "recordings.pruneExpired": recordings.pruneExpired.bind(recordings),
    "templates.create": templates.create.bind(templates),
    "actionItems.create": actionItems.create.bind(actionItems),
    "actionItems.complete": actionItems.complete.bind(actionItems),
    "policies.updateWorkspacePolicy": policies.updateWorkspacePolicy.bind(policies),
    "hookDeliveries.append": hookDeliveries.append.bind(hookDeliveries),
    "audit.append": audit.append.bind(audit),
    "events.append": events.append.bind(events),
  };

  workspaces.create = trackMutation("workspaces.create", rawMutations["workspaces.create"], mutationLog, () => {
    dirty = true;
  });
  users.create = trackMutation("users.create", rawMutations["users.create"], mutationLog, () => {
    dirty = true;
  });
  users.update = trackMutation("users.update", rawMutations["users.update"], mutationLog, () => {
    dirty = true;
  });
  workspaceMemberships.create = trackMutation(
    "workspaceMemberships.create",
    rawMutations["workspaceMemberships.create"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  passwordCredentials.upsert = trackMutation(
    "passwordCredentials.upsert",
    rawMutations["passwordCredentials.upsert"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  externalAuthIdentities.create = trackMutation(
    "externalAuthIdentities.create",
    rawMutations["externalAuthIdentities.create"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  directMessages.createThread = trackMutation(
    "directMessages.createThread",
    rawMutations["directMessages.createThread"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  directMessages.addThreadMember = trackMutation(
    "directMessages.addThreadMember",
    rawMutations["directMessages.addThreadMember"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  directMessages.updateThread = trackMutation(
    "directMessages.updateThread",
    rawMutations["directMessages.updateThread"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  directMessages.createMessage = trackMutation(
    "directMessages.createMessage",
    rawMutations["directMessages.createMessage"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  directMessages.createAttachment = trackMutation(
    "directMessages.createAttachment",
    rawMutations["directMessages.createAttachment"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  directMessages.updateAttachment = trackMutation(
    "directMessages.updateAttachment",
    rawMutations["directMessages.updateAttachment"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  directMessages.markThreadRead = trackMutation(
    "directMessages.markThreadRead",
    rawMutations["directMessages.markThreadRead"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  rooms.create = trackMutation("rooms.create", rawMutations["rooms.create"], mutationLog, () => {
    dirty = true;
  });
  meetings.create = trackMutation("meetings.create", rawMutations["meetings.create"], mutationLog, () => {
    dirty = true;
  });
  meetings.initializeSummary = trackMutation(
    "meetings.initializeSummary",
    rawMutations["meetings.initializeSummary"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  meetings.updateSummary = trackMutation(
    "meetings.updateSummary",
    rawMutations["meetings.updateSummary"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  meetings.setStatus = trackMutation("meetings.setStatus", rawMutations["meetings.setStatus"], mutationLog, () => {
    dirty = true;
  });
  meetings.setLockState = trackMutation(
    "meetings.setLockState",
    rawMutations["meetings.setLockState"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  participants.registerJoin = trackMutation(
    "participants.registerJoin",
    rawMutations["participants.registerJoin"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  participants.admitToMeeting = trackMutation(
    "participants.admitToMeeting",
    rawMutations["participants.admitToMeeting"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  participants.leaveMeeting = trackMutation(
    "participants.leaveMeeting",
    rawMutations["participants.leaveMeeting"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  participants.removeFromMeeting = trackMutation(
    "participants.removeFromMeeting",
    rawMutations["participants.removeFromMeeting"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  participants.muteAll = trackMutation("participants.muteAll", rawMutations["participants.muteAll"], mutationLog, () => {
    dirty = true;
  });
  participants.endMeeting = trackMutation(
    "participants.endMeeting",
    rawMutations["participants.endMeeting"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  recordings.upsert = trackMutation("recordings.upsert", rawMutations["recordings.upsert"], mutationLog, () => {
    dirty = true;
  });
  recordings.updateSaved = trackMutation(
    "recordings.updateSaved",
    rawMutations["recordings.updateSaved"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  recordings.deleteById = trackMutation(
    "recordings.deleteById",
    rawMutations["recordings.deleteById"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  recordings.pruneExpired = trackMutation(
    "recordings.pruneExpired",
    rawMutations["recordings.pruneExpired"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  templates.create = trackMutation("templates.create", rawMutations["templates.create"], mutationLog, () => {
    dirty = true;
  });
  actionItems.create = trackMutation("actionItems.create", rawMutations["actionItems.create"], mutationLog, () => {
    dirty = true;
  });
  actionItems.complete = trackMutation(
    "actionItems.complete",
    rawMutations["actionItems.complete"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  policies.updateWorkspacePolicy = trackMutation(
    "policies.updateWorkspacePolicy",
    rawMutations["policies.updateWorkspacePolicy"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  hookDeliveries.append = trackMutation(
    "hookDeliveries.append",
    rawMutations["hookDeliveries.append"],
    mutationLog,
    () => {
      dirty = true;
    },
  );
  audit.append = trackMutation("audit.append", rawMutations["audit.append"], mutationLog, () => {
    dirty = true;
  });
  events.append = trackMutation("events.append", rawMutations["events.append"], mutationLog, () => {
    dirty = true;
  });

  return {
    workspaces,
    users,
    workspaceMemberships,
    passwordCredentials,
    externalAuthIdentities,
    directMessages,
    rooms,
    meetings,
    participants,
    recordings,
    templates,
    actionItems,
    policies,
    hookDeliveries,
    dashboard,
    audit,
    events,
    async commit(): Promise<void> {
      try {
        dirty = compactRuntimeStore(persisted.store) || dirty;

        if (!dirty) {
          return;
        }

        persisted.version = await saveRuntimeState(sql, scope, persisted, mutationLog, rawMutations);
        dirty = false;
        mutationLog.length = 0;
      } finally {
        await dispose();
      }
    },
  };
}

async function loadRuntimeState(
  sql: SqlClient,
  scope: string,
): Promise<{ version: number; store: MemoryStore }> {
  const rows = await sql<PersistedRuntimeStateRow[]>`
    select version, state
    from opsui_runtime_state
    where scope = ${scope}
    limit 1
  `;

  const existing = rows[0];
  if (existing) {
    return {
      version: Number(existing.version),
      store: normalizeStore(existing.state),
    };
  }

  const seeded = createSeedStore();
  const inserted = await sql<PersistedRuntimeStateRow[]>`
    insert into opsui_runtime_state (scope, version, state, updated_at)
    values (${scope}, 1, ${JSON.stringify(seeded)}::jsonb, now())
    on conflict (scope) do update
      set scope = opsui_runtime_state.scope
    returning version, state
  `;

  const created = inserted[0];
  return {
    version: Number(created?.version ?? 1),
    store: created ? normalizeStore(created.state) : seeded,
  };
}

async function saveRuntimeState(
  sql: SqlClient,
  scope: string,
  persisted: { version: number; store: MemoryStore },
  mutationLog: MutationRecord[],
  rawMutations: Record<MutationName, MutationFn>,
): Promise<number> {
  let currentVersion = persisted.version;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const serializedStore = JSON.stringify(persisted.store);
    const updated = await sql<PersistedRuntimeStateRow[]>`
      update opsui_runtime_state
      set state = ${serializedStore}::jsonb,
          version = version + 1,
          updated_at = now()
      where scope = ${scope} and version = ${currentVersion}
      returning version, state
    `;

    if (updated[0]) {
      return Number(updated[0].version);
    }

    const reloaded = await loadRuntimeState(sql, scope);
    persisted.version = reloaded.version;
    persisted.store = reloaded.store;
    replayMutations(mutationLog, rawMutations);
    compactRuntimeStore(persisted.store);
    currentVersion = persisted.version;
  }

  throw new Error("Postgres runtime state commit conflict.");
}

function normalizeStore(raw: MemoryStore | string): MemoryStore {
  if (typeof raw === "string") {
    return hydrateMemoryStore(JSON.parse(raw) as Partial<MemoryStore>);
  }

  return hydrateMemoryStore(raw);
}

export function createSqlClient(connectionString: string): SqlClient {
  return postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

function trackMutation<TArgs extends unknown[], TResult>(
  name: MutationName,
  fn: (...args: TArgs) => TResult,
  mutationLog: MutationRecord[],
  markDirty: () => void,
): (...args: TArgs) => TResult {
  return (...args: TArgs) => {
    markDirty();
    mutationLog.push({
      name,
      args: cloneMutationArgs(args),
    });
    return fn(...args);
  };
}

function replayMutations(
  mutationLog: MutationRecord[],
  rawMutations: Record<MutationName, MutationFn>,
): void {
  for (const mutation of mutationLog) {
    rawMutations[mutation.name](...mutation.args);
  }
}

function cloneMutationArgs<TArgs extends unknown[]>(args: TArgs): TArgs {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(args);
  }

  return JSON.parse(JSON.stringify(args)) as TArgs;
}
