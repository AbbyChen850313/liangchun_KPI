// ── Auth ──────────────────────────────────────────────────────────────────

export interface Session {
  lineUid: string;
  name: string;
  role: "主管" | "HR" | "系統管理員" | "同仁";
  isTest: boolean;
}

export interface SessionResponse {
  token: string;
  name: string;
  role: string;
  jobTitle: string;
}

// ── Employee ──────────────────────────────────────────────────────────────

export interface Employee {
  name: string;
  dept: string;
  section: string;
  joinDate: string;
  tenure: string;
  isProbation: boolean;
  daysWorked: number;
  weight: number;
  scoreStatus: "未評分" | "草稿" | "已送出";
}

// ── Scores ────────────────────────────────────────────────────────────────

export type ScoreGrade = "甲" | "乙" | "丙" | "丁" | "";

export interface ScoreItems {
  item1: ScoreGrade;
  item2: ScoreGrade;
  item3: ScoreGrade;
  item4: ScoreGrade;
  item5: ScoreGrade;
  item6: ScoreGrade;
}

export interface ScoreRecord {
  scores: ScoreItems;
  special: number;
  note: string;
  status: "草稿" | "已送出";
}

export interface ScoreResult {
  success: boolean;
  status: string;
  rawScore: number;
  finalScore: number;
  weightedScore: number;
}

// ── Annual summary ────────────────────────────────────────────────────────

export interface AnnualEmployeeSummary {
  quarters: Record<string, number | null>;  // e.g. { "115Q1": 80.5, "115Q2": null }
  annualTotal: number;
  completedCount: number;
}

export interface AnnualSummaryResponse {
  year: string;
  quarters: string[];
  summary: Record<string, AnnualEmployeeSummary>;  // keyed by empName
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export interface DashboardData {
  quarter: string;
  quarterDescription: string;
  managerName: string;
  total: number;
  scored: number;
  draft: number;
  pending: number;
  employees: Employee[];
  myScores: Record<string, ScoreRecord>;
  settings: Record<string, string>;
}

export interface SysAdminDashboard {
  isSysAdmin: true;
  managerName: string;
  accounts: Account[];
  settings: Record<string, string>;
}

export interface HRDashboard {
  isHR: true;
}

export type AnyDashboard = DashboardData | SysAdminDashboard | HRDashboard;

// ── Account ───────────────────────────────────────────────────────────────

export interface Account {
  name: string;
  lineUid: string;
  testUid: string;
  displayName: string;
  boundAt: string;
  status: string;
  jobTitle: string;
  role: string;
  phone: string;
  employeeId: string;
}

// ── Score item (評分項目) ──────────────────────────────────────────────────

export interface ScoreItem {
  code: string;
  name: string;
  description: string;
}

// ── Season scoring ─────────────────────────────────────────────────────────

export type QuarterStatus = "未開始" | "評分中" | "已完成";

export interface QuarterOption {
  quarter: string;
  description: string;
  isAvailable: boolean;
  status: QuarterStatus;
  scoredCount: number;
  totalCount: number;
}

export interface SeasonScoreStatus {
  year: string;
  quarters: QuarterOption[];
}

export interface QuarterEmployee {
  name: string;
  dept: string;
  section: string;
  joinDate: string;
  scoreStatus: "未評分" | "草稿" | "已送出";
}

// ── Settings ──────────────────────────────────────────────────────────────

export type Settings = Record<string, string>;

// ── Batch submit (HR proxy) ───────────────────────────────────────────────

export interface BatchScoreEntry {
  managerName: string;
  managerLineUid: string;
  empName: string;
  section: string;
  scores: ScoreItems;
  special: number;
  note: string;
}

export interface BatchSubmitResult {
  success: boolean;
  submitted: number;
  failed: Array<{ empName: string; error: string }>;
}
