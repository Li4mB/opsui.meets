export interface ReadinessEvidence {
  path: string;
  line: number | null;
  note: string;
}

export interface ReadinessItem {
  id: string;
  title: string;
  status: string;
  summary: string;
  details: string[];
  evidence: ReadinessEvidence[];
}

export interface ReadinessReport {
  generatedAt: string;
  overallStatus: string;
  recommendedNextStep: string;
  summary: {
    readyFoundations: number;
    blockers: number;
    prelaunchHardening: number;
  };
  readyFoundations: ReadinessItem[];
  blockers: ReadinessItem[];
  prelaunchHardening: ReadinessItem[];
}

export const READINESS_REPORT_PATH = "/opsui-meets.readiness.json";

export async function loadReadinessReport(): Promise<ReadinessReport | null> {
  const response = await fetch(READINESS_REPORT_PATH, {
    headers: {
      accept: "application/json",
    },
  }).catch(() => null);

  if (!response?.ok) {
    return null;
  }

  return (await response.json().catch(() => null)) as ReadinessReport | null;
}
