export { scanTextForSlop, scanDiffForSlop } from "./scanner.js";
export type { GuardianViolation, GuardianRuleFamily } from "./scanner.js";
export { detectGuardianScope } from "./scope.js";
export type { GuardianScope } from "./scope.js";
export { interceptTurn, autoFixRawErrorFormat } from "./interceptor.js";
export type { TurnFileChange, InterceptResult, GuardianFixedFix } from "./interceptor.js";
export { guardedInit } from "./init.js";
export type { GuardedInitResult } from "./init.js";
export { preCommitHookScript, GUARDIAN_INIT_HOOK_REL } from "./hook.js";
export { languageAdvice, languageRulesBlock } from "./langRules.js";
export {
  recordHealthScan,
  loadHealthSnapshot,
  deriveHealth,
  formatHealth,
  projectHealthKey,
  healthSnapshotPath,
  HEALTH_TOP_RULES,
} from "./health.js";
export type { HealthSnapshot, HealthDerived, ScanObservation } from "./health.js";
export { parseCustomGuardianRules, loadCustomGuardianRules, MAX_CUSTOM_RULES } from "./rules.js";
export type { CustomGuardianRule } from "./rules.js";
export { loadFreshAllowlist } from "./allowlist.js";
export type { FreshAllowlist, FreshAllowlistEntry } from "./allowlist.js";
