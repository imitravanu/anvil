import type { ProviderId, StreamEvent } from "../providers/types.js";

export type TestCriterion =
  | "streaming"
  | "toolCalls"
  | "multiTurn"
  | "errorPath"
  | "rateLimit";

export interface CriterionResult {
  passed: boolean;
  durationMs: number;
  details?: string;
  error?: string;
}

export interface ProviderCertificationResult {
  providerId: ProviderId;
  model: string;
  status: "live" | "broken" | "untested";
  passed: boolean;
  totalDurationMs: number;
  criteria: Record<TestCriterion, CriterionResult>;
  error?: string;
}

export interface CertifyOptions {
  model?: string;
  timeoutMs?: number;
  mock?: boolean;
  verbose?: boolean;
  onCriterionStart?: (criterion: TestCriterion) => void;
  onCriterionComplete?: (criterion: TestCriterion, result: CriterionResult) => void;
}
