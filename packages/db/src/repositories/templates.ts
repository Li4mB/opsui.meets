import type { CreateTemplateInput, TemplateSummary } from "@opsui/shared-types";
import { getMemoryStore, type MemoryStoreAccessor } from "../store";

export class TemplatesRepository {
  constructor(private readonly getStore: MemoryStoreAccessor = getMemoryStore) {}

  listByWorkspace(workspaceId: string): TemplateSummary[] {
    return this.getStore().templates.filter((template) => template.workspaceId === workspaceId);
  }

  create(workspaceId: string, input: CreateTemplateInput): TemplateSummary {
    const template: TemplateSummary = {
      id: crypto.randomUUID(),
      workspaceId,
      name: input.name,
      templateType: input.templateType,
      description: input.description,
      isSystem: false,
    };

    const store = this.getStore();
    store.templates.unshift(template);
    return template;
  }
}
