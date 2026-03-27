import type { CreateTemplateInput } from "@opsui/shared-types";
import { getActorContext } from "../lib/actor";
import { getRepositories } from "../lib/data";
import { withIdempotency } from "../lib/idempotency";
import { json } from "../lib/http";
import { optionalEnum, parseJson, requireNonEmptyString } from "../lib/request";
import type { Env } from "../types";

export async function createTemplate(request: Request, env: Env): Promise<Response> {
  const actor = getActorContext(request);
  const repositories = await getRepositories(env);
  const payload = await parseJson<CreateTemplateInput>(request);

  const result = await withIdempotency(request, "templates.create", async () => {
    const template = repositories.templates.create(actor.workspaceId, {
      name: requireNonEmptyString(payload.name, "template_name_required"),
      templateType: optionalEnum(
        payload.templateType,
        ["standup", "sales_demo", "training", "lecture", "webinar"] as const,
        "standup",
        "invalid_template_type",
      ),
      description: requireNonEmptyString(payload.description, "template_description_required"),
    });

    repositories.audit.append({
      actor: actor.email ?? actor.userId,
      action: "template.created",
      target: template.name,
    });

    return {
      body: template,
      status: 201,
    };
  });

  await repositories.commit();
  return json(result.body, { status: result.status });
}
