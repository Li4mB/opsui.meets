export function getMeetingRecordingAction(pathname: string): {
  meetingInstanceId: string;
  action: "start" | "stop";
} | null {
  const match = pathname.match(
    /^\/v1\/meetings\/(?<meetingInstanceId>[^/]+)\/recordings\/(?<action>start|stop)$/,
  );

  if (!match?.groups?.meetingInstanceId || !match.groups.action) {
    return null;
  }

  return {
    meetingInstanceId: match.groups.meetingInstanceId,
    action: match.groups.action as "start" | "stop",
  };
}
