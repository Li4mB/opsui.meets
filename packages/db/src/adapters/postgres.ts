import postgres from "postgres";
import { ActionItemsRepository } from "../repositories/action-items";
import { AuditRepository } from "../repositories/audit";
import { DashboardRepository } from "../repositories/dashboard";
import { EventsRepository } from "../repositories/events";
import { HookDeliveriesRepository } from "../repositories/hook-deliveries";
import { MeetingsRepository } from "../repositories/meetings";
import { ParticipantsRepository } from "../repositories/participants";
import { PoliciesRepository } from "../repositories/policies";
import { RecordingsRepository } from "../repositories/recordings";
import { RoomsRepository } from "../repositories/rooms";
import { TemplatesRepository } from "../repositories/templates";
import type { RequestRepositoryContext } from "../contracts";
import { compactRuntimeStore, createSeedStore, type MemoryStore } from "../store";

const DEFAULT_SCOPE = "global";

type SqlClient = ReturnType<typeof postgres>;

interface PersistedRuntimeStateRow {
  version: number | string;
  state: MemoryStore | string;
}

interface PostgresRepositoryContextOptions {
  connectionString?: string;
}

export async function createPostgresRepositoryContext(
  options: PostgresRepositoryContextOptions = {},
): Promise<RequestRepositoryContext> {
  const connectionString = options.connectionString?.trim();
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
    persisted = await loadRuntimeState(sql, DEFAULT_SCOPE);
  } catch (error) {
    await dispose();
    throw error;
  }

  const getStore = () => persisted.store;
  let dirty = compactRuntimeStore(persisted.store);

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

  rooms.create = trackMutation(rooms.create.bind(rooms), () => {
    dirty = true;
  });
  meetings.create = trackMutation(meetings.create.bind(meetings), () => {
    dirty = true;
  });
  meetings.initializeSummary = trackMutation(meetings.initializeSummary.bind(meetings), () => {
    dirty = true;
  });
  meetings.updateSummary = trackMutation(meetings.updateSummary.bind(meetings), () => {
    dirty = true;
  });
  meetings.setStatus = trackMutation(meetings.setStatus.bind(meetings), () => {
    dirty = true;
  });
  meetings.setLockState = trackMutation(meetings.setLockState.bind(meetings), () => {
    dirty = true;
  });
  participants.registerJoin = trackMutation(participants.registerJoin.bind(participants), () => {
    dirty = true;
  });
  participants.admitToMeeting = trackMutation(participants.admitToMeeting.bind(participants), () => {
    dirty = true;
  });
  participants.leaveMeeting = trackMutation(participants.leaveMeeting.bind(participants), () => {
    dirty = true;
  });
  participants.removeFromMeeting = trackMutation(participants.removeFromMeeting.bind(participants), () => {
    dirty = true;
  });
  participants.muteAll = trackMutation(participants.muteAll.bind(participants), () => {
    dirty = true;
  });
  participants.endMeeting = trackMutation(participants.endMeeting.bind(participants), () => {
    dirty = true;
  });
  recordings.upsert = trackMutation(recordings.upsert.bind(recordings), () => {
    dirty = true;
  });
  templates.create = trackMutation(templates.create.bind(templates), () => {
    dirty = true;
  });
  actionItems.create = trackMutation(actionItems.create.bind(actionItems), () => {
    dirty = true;
  });
  actionItems.complete = trackMutation(actionItems.complete.bind(actionItems), () => {
    dirty = true;
  });
  policies.updateWorkspacePolicy = trackMutation(policies.updateWorkspacePolicy.bind(policies), () => {
    dirty = true;
  });
  hookDeliveries.append = trackMutation(hookDeliveries.append.bind(hookDeliveries), () => {
    dirty = true;
  });
  audit.append = trackMutation(audit.append.bind(audit), () => {
    dirty = true;
  });
  events.append = trackMutation(events.append.bind(events), () => {
    dirty = true;
  });

  return {
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

        persisted.version = await saveRuntimeState(sql, DEFAULT_SCOPE, persisted.store, persisted.version);
        dirty = false;
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
  store: MemoryStore,
  version: number,
): Promise<number> {
  const serializedStore = JSON.stringify(store);
  let currentVersion = version;

  for (let attempt = 0; attempt < 4; attempt += 1) {
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
    currentVersion = reloaded.version;
  }

  throw new Error("Postgres runtime state commit conflict.");
}

function normalizeStore(raw: MemoryStore | string): MemoryStore {
  if (typeof raw === "string") {
    return JSON.parse(raw) as MemoryStore;
  }

  return raw;
}

function createSqlClient(connectionString: string): SqlClient {
  return postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 5,
  });
}

function trackMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  markDirty: () => void,
): (...args: TArgs) => TResult {
  return (...args: TArgs) => {
    markDirty();
    return fn(...args);
  };
}
