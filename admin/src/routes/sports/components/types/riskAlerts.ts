export type RiskAlert = {
  id: string;
  entityId: string;
  entityType: "player" | "agent";
  entityName: string;
  riskLevel: "HIGH" | "MEDIUM" | "LOW" | "MINIMAL" | "N/A";
  riskScore: number;
  metrics: {
    liability: number;
    exposure: number;
    betCount: number;
    odds: number;
  };
  timestamp: Date;
};

