import type { ParticipantState } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor, type StoredParticipantState } from "../store";

const DEFAULT_STALE_SESSION_MS = 2 * 60_000;

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
    return toPublicParticipant(participant);
  }

  expireStaleSessions(
    meetingInstanceId: string,
    options?: {
      now?: Date;
      staleAfterMs?: number;
    },
  ): ParticipantState[] {
    const now = options?.now ?? new Date();
    const staleAfterMs = options?.staleAfterMs ?? DEFAULT_STALE_SESSION_MS;
    const cutoff = now.getTime() - staleAfterMs;
    const expired: ParticipantState[] = [];

    for (const participant of this.getStore().participants) {
      if (participant.meetingInstanceId !== meetingInstanceId || participant.presence === "left") {
        continue;
      }

      const sessionLastSeenAt = participant.sessionLastSeenAt ? Date.parse(participant.sessionLastSeenAt) : Number.NaN;
      if (!Number.isFinite(sessionLastSeenAt) || sessionLastSeenAt > cutoff) {
        continue;
      }

      participant.presence = "left";
      participant.audio = "muted";
      participant.video = "off";
      participant.handRaised = false;
      expired.push(toPublicParticipant(participant));
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
    sessionLastSeenAt: _sessionLastSeenAt,
    ...publicParticipant
  } = participant;
  return publicParticipant;
}
