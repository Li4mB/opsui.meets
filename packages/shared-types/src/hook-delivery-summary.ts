import type { HookDeliveryAttempt } from "./hook-delivery";

export interface HookDeliverySummary {
  currentFailureCount: number;
  autoOnEndFailureCount: number;
  historicalFailureCount: number;
  attentionItems: HookDeliveryAttempt[];
}
