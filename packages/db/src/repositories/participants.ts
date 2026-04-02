import type { ParticipantState } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor, type StoredParticipantState } from "../store";

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
      existing.joinedAt =
        input.presence === "active" ? existing.joinedAt ?? new Date().toISOString() : existing.joinedAt;
      return toPublicParticipant(existing);
    }

    const participant: StoredParticipantState = {
      participantId: crypto.randomUUID(),
      meetingInstanceId: input.meetingInstanceId,
      displayName: input.displayName,
      joinSessionId: input.joinSessionId,
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

  admitToMeeting(meetingInstanceId: string, participantId: string): ParticipantState | null {
    const participant = this.getStore().participants.find(
      (item) => item.meetingInstanceId === meetingInstanceId && item.participantId === participantId,
    );

    if (!participant) {
      return null;
    }

    participant.presence = "active";
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
      participant.audio = "blocked";
      participant.video = "blocked";
      participant.handRaised = false;
    }

    return participants.map(toPublicParticipant);
  }
}

function toPublicParticipant(participant: StoredParticipantState): ParticipantState {
  const { joinSessionId: _joinSessionId, ...publicParticipant } = participant;
  return publicParticipant;
}
