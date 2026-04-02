export type RoomEventType =
  | "participant.join"
  | "participant.leave"
  | "participant.admitted"
  | "participant.removed"
  | "participant.role_changed"
  | "participant.hand_raised"
  | "participant.hand_lowered"
  | "participants.muted_all"
  | "lobby.updated"
  | "chat.message_sent"
  | "chat.message_deleted"
  | "room.locked"
  | "room.unlocked"
  | "room.ended"
  | "recording.started"
  | "recording.stopped"
  | "action_item.created"
  | "action_item.completed"
  | "follow_up.dispatched";

export interface ChatMessageEventPayload {
  displayName: string;
  text: string;
}

export interface RoomEvent<TPayload = unknown> {
  eventId: string;
  roomEventNumber: number;
  type: RoomEventType;
  meetingInstanceId: string;
  occurredAt: string;
  actorParticipantId?: string;
  payload: TPayload;
}
