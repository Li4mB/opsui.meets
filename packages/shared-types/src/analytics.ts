export interface DashboardSummary {
  roomsCount: number;
  meetingsCount: number;
  activeParticipants: number;
  lobbyParticipants: number;
  raisedHands: number;
}

export interface AdminOverviewMetric {
  label: string;
  value: string;
}

export interface AdminOverview {
  metrics: AdminOverviewMetric[];
}
