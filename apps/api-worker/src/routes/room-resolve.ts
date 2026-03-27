import { getRepositories } from "../lib/data";
import { json, notFound } from "../lib/http";
import type { Env } from "../types";

export async function resolveRoom(slug: string, env: Env): Promise<Response> {
  const repositories = await getRepositories(env);
  const room = repositories.rooms.getBySlug(slug);
  if (!room) {
    return notFound();
  }

  const response = json({
    id: room.id,
    slug: room.slug,
    name: room.name,
    roomType: room.roomType,
  });
  await repositories.commit();
  return response;
}
