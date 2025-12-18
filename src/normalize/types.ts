export type WarningSeverity = "info" | "warning" | "error";

export interface NormalizationWarning {
  code: string;
  message: string;
  severity: WarningSeverity;
}
