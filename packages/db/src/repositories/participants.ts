import type { ParticipantState } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor, type StoredParticipantState } from "../store";

const DEFAULT_STALE_SESSION_MS = 2 * 60_000;
const DEFAULT_RECONNECT_GRACE_MS = 5 * 60_000;

export class ParticipantsRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  listByMeetingInstance(meetingInstanceId: string): ParticipantState[] {
    return this.getStore().participants
      .filter((participant) => participant.meetingInstanceId === meetingInstanceId)
      .map(toPublicParticipant);
  }

  registerJoin(input: {
    meetingInstanceId: string;
    displayName: string;
    joinSessionId?: string;
    presence: ParticipantState["presence"];
    role?: ParticipantState["role"];
  }): ParticipantState {
    const store = this.getStore();
    const existing = input.joinSessionId
      ? store.participants.find(
          (participant) =>
            participant.meetingInstanceId === input.meetingInstanceId &&
            participant.joinSessionId === input.joinSessionId,
        )
      : store.participants.find(
          (participant) =>
            participant.meetingInstanceId === input.meetingInstanceId &&
            participant.displayName === input.displayName,
        );

    if (existing) {
      existing.presence = input.presence;
      existing.displayName = input.displayName;
      existing.joinSessionId = input.joinSessionId ?? existing.joinSessionId;
      existing.role = input.role ?? existing.role;
      existing.sessionLastSeenAt = new Date().toISOString();
      clearReconnectLease(existing);
      existing.joinedAt =
        input.presence === "active" ? existing.joinedAt ?? new Date().toISOString() : existing.joinedAt;
      return toPublicParticipant(existing);
    }

    const participant: StoredParticipantState = {
      participantId: crypto.randomUUID(),
      meetingInstanceId: input.meetingInstanceId,
      displayName: input.displayName,
      joinSessionId: input.joinSessionId,
      sessionLastSeenAt: new Date().toISOString(),
      role: input.role ?? "participant",
      presence: input.presence,
      audio: input.presence === "active" ? "unmuted" : "muted",
      video: "off",
      handRaised: false,
      joinedAt: input.presence === "active" ? new Date().toISOString() : undefined,
    };

    store.participants.unshift(participant);
    return toPublicParticipant(participant);
  }

  touchSessionLease(
    meetingInstanceId: string,
    participantId: string,
    joinSessionId?: string,
  ): ParticipantState | null {
    const participant = this.getStore().participants.find(
      (item) => item.meetingInstanceId === meetingInstanceId && item.participantId === participantId,
    );

    if (!participant || participant.presence === "left") {
      return null;
    }

    if (joinSessionId && participant.joinSessionId && participant.joinSessionId !== joinSessionId) {
      return null;
    }

    participant.sessionLastSeenAt = new Date().toISOString();
    if (participant.presence === "reconnecting") {
      participant.presence = participant.reconnectingToPresence ?? "active";
      clearReconnectLease(participant);
    }
    return toPublicParticipant(participant);
  }

  expireStaleSessions(
    meetingInstanceId: string,
    options?: {
      now?: Date;
      reconnectGraceMs?: number;
      staleAfterMs?: number;
    },
  ): Array<{
    action: "expired" | "reconnecting";
    participant: ParticipantState;
  }> {
    const now = options?.now ?? new Date();
    const reconnectGraceMs = options?.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS;
    const staleAfterMs = options?.staleAfterMs ?? DEFAULT_STALE_SESSION_MS;
    const cutoff = now.getTime() - staleAfterMs;
    const expired: Array<{
      action: "expired" | "reconnecting";
      participant: ParticipantState;
    }> = [];
    const nowIso = now.toISOString();

    for (const participant of this.getStore().participants) {
      if (participant.meetingInstanceId !== meetingInstanceId || participant.presence === "left") {
        continue;
      }

      const sessionLastSeenAt = participant.sessionLastSeenAt ? Date.parse(participant.sessionLastSeenAt) : Number.NaN;
      if (!Number.isFinite(sessionLastSeenAt) || sessionLastSeenAt > cutoff) {
        continue;
      }

      if (participant.presence === "reconnecting") {
        const reconnectingSinceAt = participant.reconnectingSinceAt
          ? Date.parse(participant.reconnectingSinceAt)
          : Number.NaN;
        if (Number.isFinite(reconnectingSinceAt) && now.getTime() - reconnectingSinceAt <= reconnectGraceMs) {
          continue;
        }

        participant.presence = "left";
        participant.sessionLastSeenAt = nowIso;
        participant.audio = "muted";
        participant.video = "off";
        participant.handRaised = false;
        clearReconnectLease(participant);
        expired.push({
          action: "expired",
          participant: toPublicParticipant(participant),
        });
        continue;
      }

      participant.reconnectingToPresence = toReconnectTargetPresence(participant.presence);
      participant.reconnectingSinceAt = nowIso;
      participant.presence = "reconnecting";
      expired.push({
        action: "reconnecting",
        participant: toPublicParticipant(participant),
      });
    }

    return expired;
  }

  admitToMeeting(meetingInstanceId: string, participantId: string): ParticipantState | null {
    const participant = this.getStore().participants.find(
      (item) => item.meetingInstanceId === meetingInstanceId && item.participantId === participantId,
    );

    if (!participant) {
      return null;
    }

    participant.presence = "active";
    participant.sessionLastSeenAt = new Date().toISOString();
    clearReconnectLease(participant);
    participant.joinedAt = participant.joinedAt ?? new Date().toISOString();
    return participant ? toPublicParticipant(participant) : null;
  }

  leaveMeeting(meetingInstanceId: string, participantId: string): ParticipantState | null {
    const participant = this.getStore().participants.find(
      (item) => item.meetingInstanceId === meetingInstanceId && item.participantId === participantId,
    );

    if (!participant) {
      return null;
    }

    participant.presence = "left";
    participant.sessionLastSeenAt = new Date().toISOString();
    clearReconnectLease(participant);
    participant.audio = "muted";
    participant.video = "off";
    participant.handRaised = false;
    return participant ? toPublicParticipant(participant) : null;
  }

  removeFromMeeting(meetingInstanceId: string, participantId: string): ParticipantState | null {
    const participant = this.getStore().participants.find(
      (item) => item.meetingInstanceId === meetingInstanceId && item.participantId === participantId,
    );

    if (!participant) {
      return null;
    }

    participant.presence = "left";
    participant.sessionLastSeenAt = new Date().toISOString();
    clearReconnectLease(participant);
    participant.audio = "blocked";
    participant.video = "blocked";
    participant.handRaised = false;
    return participant ? toPublicParticipant(participant) : null;
  }

  muteAll(meetingInstanceId: string): ParticipantState[] {
    const participants = this.getStore().participants.filter(
      (item) =>
        item.meetingInstanceId === meetingInstanceId &&
        item.presence !== "left" &&
        item.presence !== "lobby",
    );

    for (const participant of participants) {
      participant.audio = "muted";
    }

    return participants.map(toPublicParticipant);
  }

  endMeeting(meetingInstanceId: string): ParticipantState[] {
    const participants = this.getStore().participants.filter(
      (item) => item.meetingInstanceId === meetingInstanceId && item.presence !== "left",
    );

    for (const participant of participants) {
      participant.presence = "left";
      participant.sessionLastSeenAt = new Date().toISOString();
      clearReconnectLease(participant);
      participant.audio = "blocked";
      participant.video = "blocked";
      participant.handRaised = false;
    }

    return participants.map(toPublicParticipant);
  }
}

function toPublicParticipant(participant: StoredParticipantState): ParticipantState {
  const {
    joinSessionId: _joinSessionId,
    reconnectingSinceAt: _reconnectingSinceAt,
    reconnectingToPresence: _reconnectingToPresence,
    sessionLastSeenAt: _sessionLastSeenAt,
    ...publicParticipant
  } = participant;
  return publicParticipant;
}

function clearReconnectLease(participant: StoredParticipantState): void {
  participant.reconnectingSinceAt = undefined;
  participant.reconnectingToPresence = undefined;
}

function toReconnectTargetPresence(
  presence: ParticipantState["presence"],
): Exclude<ParticipantState["presence"], "left" | "reconnecting"> {
  if (presence === "lobby" || presence === "breakout") {
    return presence;
  }

  return "active";
}
