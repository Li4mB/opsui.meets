export interface TemplateSummary {
  id: string;
  workspaceId: string;
  name: string;
  templateType: "standup" | "sales_demo" | "training" | "lecture" | "webinar";
  description: string;
  isSystem: boolean;
}

export interface CreateTemplateInput {
  name: string;
  templateType: TemplateSummary["templateType"];
  description: string;
}
