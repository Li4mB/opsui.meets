import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { buildFollowUpFilename, buildFollowUpMarkdown, buildMeetingFollowUpPackage } from "../lib/follow-up-package";
import { notFound } from "../lib/http";
import type { Env } from "../types";

export async function exportFollowUp(request: Request, meetingInstanceId: string, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const meeting = repositories.meetings.getById(meetingInstanceId);

  if (!meeting) {
    return notFound();
  }

  const markdown = buildFollowUpMarkdown(buildMeetingFollowUpPackage(repositories, meetingInstanceId));

  repositories.audit.append({
    actor: actor.email ?? actor.userId,
    action: "follow_up.exported",
    target: meeting.title,
  });
  await repositories.commit();

  return new Response(markdown, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${buildFollowUpFilename(meeting.title)}.md"`,
    },
  });
}
