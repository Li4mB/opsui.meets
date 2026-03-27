export interface ActionItem {
  id: string;
  meetingInstanceId: string;
  sourceType: "manual" | "system";
  title: string;
  ownerLabel?: string;
  dueAt?: string;
  status: "open" | "done";
  createdAt: string;
}

export interface CreateActionItemInput {
  title: string;
  ownerLabel?: string;
  dueAt?: string;
}
