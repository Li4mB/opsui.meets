export function getMeetingSummaryPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/summary$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingParticipantsPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/participants$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingParticipantHeartbeatPath(
  pathname: string,
): { meetingInstanceId: string; participantId: string } | null {
  const match = pathname.match(
    /^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/participants\/(?<participantId>[^/]+)\/heartbeat$/,
  );
  if (!match?.groups?.meetingInstanceId || !match.groups.participantId) {
    return null;
  }

  return {
    meetingInstanceId: match.groups.meetingInstanceId,
    participantId: match.groups.participantId,
  };
}

export function getMeetingAttendanceExportPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/attendance\/export$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingFollowUpExportPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/follow-up\/export$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingFollowUpDispatchPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/follow-up\/dispatch$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingFollowUpRetryPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/follow-up\/retry$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingFollowUpAttemptsPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/follow-up\/attempts$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingEventsPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/events$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingActionItemsPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/action-items$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingActionItemCompletePath(
  pathname: string,
): { meetingInstanceId: string; actionItemId: string } | null {
  const match = pathname.match(
    /^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/action-items\/(?<actionItemId>[^/]+)\/complete$/,
  );
  if (!match?.groups?.meetingInstanceId || !match.groups.actionItemId) {
    return null;
  }

  return {
    meetingInstanceId: match.groups.meetingInstanceId,
    actionItemId: match.groups.actionItemId,
  };
}

export function getMeetingRecordingPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/recordings$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingMediaSessionPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/media-session$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingChatMessagesPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/chat\/messages$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingDetailPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingJoinPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/join$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingMuteAllPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/moderation\/mute-all$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingLockPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/moderation\/lock$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingUnlockPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/moderation\/unlock$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingEndPath(pathname: string): { meetingInstanceId: string } | null {
  const match = pathname.match(/^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/end$/);
  if (!match?.groups?.meetingInstanceId) {
    return null;
  }

  return { meetingInstanceId: match.groups.meetingInstanceId };
}

export function getMeetingParticipantModerationPath(
  pathname: string,
): { meetingInstanceId: string; participantId: string; action: "admit" | "leave" | "remove" } | null {
  const match = pathname.match(
    /^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/participants\/(?<participantId>[^/]+)\/(?<action>admit|leave|remove)$/,
  );
  if (!match?.groups?.meetingInstanceId || !match.groups.participantId || !match.groups.action) {
    return null;
  }

  return {
    meetingInstanceId: match.groups.meetingInstanceId,
    participantId: match.groups.participantId,
    action: match.groups.action as "admit" | "leave" | "remove",
  };
}

export function getRoomResolvePath(pathname: string): { slug: string } | null {
  const match = pathname.match(/^\/v1\/rooms\/resolve\/(?<slug>[^/]+)$/);
  if (!match?.groups?.slug) {
    return null;
  }

  return { slug: match.groups.slug };
}

export function getRoomStatePath(pathname: string): { slug: string } | null {
  const match = pathname.match(/^\/v1\/rooms\/resolve\/(?<slug>[^/]+)\/state$/);
  if (!match?.groups?.slug) {
    return null;
  }

  return { slug: match.groups.slug };
}

export function getDirectMessageThreadPath(pathname: string): { threadId: string } | null {
  const match = pathname.match(/^\/v1\/direct-messages\/threads\/(?<threadId>[^/]+)$/);
  if (!match?.groups?.threadId) {
    return null;
  }

  return { threadId: match.groups.threadId };
}

export function getDirectMessageThreadMessagesPath(pathname: string): { threadId: string } | null {
  const match = pathname.match(/^\/v1\/direct-messages\/threads\/(?<threadId>[^/]+)\/messages$/);
  if (!match?.groups?.threadId) {
    return null;
  }

  return { threadId: match.groups.threadId };
}

export function getDirectMessageThreadReadPath(pathname: string): { threadId: string } | null {
  const match = pathname.match(/^\/v1\/direct-messages\/threads\/(?<threadId>[^/]+)\/read$/);
  if (!match?.groups?.threadId) {
    return null;
  }

  return { threadId: match.groups.threadId };
}
