import type { ParticipantState } from "@opsui/shared-types";

export const TEST_ROOM_CODE = "test";
export const TEST_ROOM_DUMMY_USER_DEFAULT = 0;
export const TEST_ROOM_DUMMY_USER_MAX = 100;

const TEST_ROOM_DUMMY_PARTICIPANT_ID_PREFIX = "synthetic-test-user:";

export function isTestRoomCode(meetingCode: string): boolean {
  return meetingCode.trim().toLowerCase() === TEST_ROOM_CODE;
}

export function isTestRoomDummyParticipantId(participantId: string): boolean {
  return participantId.startsWith(TEST_ROOM_DUMMY_PARTICIPANT_ID_PREFIX);
}

export function createTestRoomDummyParticipants(input: {
  count: number;
  joinedAt: string;
  meetingInstanceId: string;
}): ParticipantState[] {
  return Array.from({ length: input.count }, (_, index) => {
    const displayNumber = index + 1;
    return {
      audio: "muted",
      displayName: `Test User ${displayNumber}`,
      handRaised: false,
      joinedAt: input.joinedAt,
      meetingInstanceId: input.meetingInstanceId,
      participantId: `${TEST_ROOM_DUMMY_PARTICIPANT_ID_PREFIX}${displayNumber}`,
      presence: "active",
      role: "participant",
      video: "off",
    };
  });
}
