import type { ParticipantState } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class ParticipantsRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  listByMeetingInstance(meetingInstanceId: string): ParticipantState[] {
    return this.getStore().participants.filter(
      (participant) => participant.meetingInstanceId === meetingInstanceId,
    );
  }

  registerJoin(input: {
    meetingInstanceId: string;
    displayName: string;
    presence: ParticipantState["presence"];
    role?: ParticipantState["role"];
  }): ParticipantState {
    const store = this.getStore();
    const existing = store.participants.find(
      (participant) =>
        participant.meetingInstanceId === input.meetingInstanceId &&
        participant.displayName === input.displayName,
    );

    if (existing) {
      existing.presence = input.presence;
      existing.role = input.role ?? existing.role;
      existing.joinedAt =
        input.presence === "active" ? existing.joinedAt ?? new Date().toISOString() : existing.joinedAt;
      return existing;
    }

    const participant: ParticipantState = {
      participantId: crypto.randomUUID(),
      meetingInstanceId: input.meetingInstanceId,
      displayName: input.displayName,
      role: input.role ?? "participant",
      presence: input.presence,
      audio: input.presence === "active" ? "unmuted" : "muted",
      video: "off",
      handRaised: false,
      joinedAt: input.presence === "active" ? new Date().toISOString() : undefined,
    };

    store.participants.unshift(participant);
    return participant;
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
    return participant;
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
    return participant;
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

    return participants;
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

    return participants;
  }
}
