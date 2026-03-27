export interface AuditLogEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  occurredAt: string;
}
