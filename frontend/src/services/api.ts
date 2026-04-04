/**
 * Axios client pre-configured for the Flask backend.
 * Automatically injects the session JWT from localStorage.
 */

import axios from "axios";
import type {
  AnnualSummaryResponse,
  QuarterEmployee,
  SeasonScoreStatus,
  WorkLog,
} from "../types";
import { refreshRole, SESSION_KEY } from "./authRefresh";
import { liffAdapter } from "../adapters/liff";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
});

// Inject JWT on every request
api.interceptors.request.use((req) => {
  const token = localStorage.getItem(SESSION_KEY);
  if (token) {
    req.headers.Authorization = `Bearer ${token}`;
  }
  return req;
});

// Normalise errors; on 401 attempt a single role-refresh then retry.
// Only trigger the reload recovery when the request carried a session JWT
// (Authorization header). Session-creation endpoints (/api/auth/session,
// /api/auth/line-oauth) pass the LINE access token in the body — they have
// no Authorization header, so a 401 from them must propagate as an error
// rather than triggering reload, which would restart the auth flow and loop.
// Exception: needBind responses must propagate as-is so useLiff can handle
// the bind flow.
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config as any;
    const responseData = err.response?.data ?? {};

    const isNeedBind = Boolean(responseData.needBind);
    const hadSessionToken = Boolean(config.headers?.Authorization);
    if (err.response?.status === 401 && !config._retry && !isNeedBind && hadSessionToken) {
      config._retry = true;
      const newRole = await refreshRole();
      if (newRole) {
        const freshToken = localStorage.getItem(SESSION_KEY);
        config.headers = { ...config.headers, Authorization: `Bearer ${freshToken}` };
        return api(config);
      }
      // Refresh failed — clear session and force re-login
      localStorage.removeItem(SESSION_KEY);
      liffAdapter.logout();
      window.location.reload();
    }

    const normalised = new Error(responseData.error ?? err.message ?? "網路錯誤") as any;
    normalised.response = err.response;
    throw normalised;
  }
);

export async function apiGetAnnualSummary(year?: string): Promise<AnnualSummaryResponse> {
  const params = year ? `?year=${encodeURIComponent(year)}` : "";
  const res = await api.get<AnnualSummaryResponse>(`/api/scoring/annual-summary${params}`);
  return res.data;
}

export async function apiGetSeasonStatus(year?: string): Promise<SeasonScoreStatus> {
  const params = year ? `?year=${encodeURIComponent(year)}` : "";
  const res = await api.get<SeasonScoreStatus>(`/api/scoring/season-status${params}`);
  return res.data;
}

export interface QuarterEmployeesResponse {
  quarter: string;
  employees: QuarterEmployee[];
}

export async function apiGetQuarterEmployees(quarter: string): Promise<QuarterEmployeesResponse> {
  const res = await api.get<QuarterEmployeesResponse>(
    `/api/scoring/quarter-employees?quarter=${encodeURIComponent(quarter)}`
  );
  return res.data;
}

// ── Work diary ────────────────────────────────────────────────────────────

export async function apiGetMyLogs(): Promise<WorkLog[]> {
  const res = await api.get<{ logs: WorkLog[] }>("/api/diary/my-logs");
  return res.data.logs;
}

export async function apiCreateLog(date: string, content: string): Promise<{ id: string }> {
  const res = await api.post<{ id: string }>("/api/diary/log", { date, content });
  return res.data;
}

export async function apiUpdateLog(logId: string, date: string, content: string): Promise<void> {
  await api.put(`/api/diary/log/${encodeURIComponent(logId)}`, { date, content });
}

export async function apiDeleteLog(logId: string): Promise<void> {
  await api.delete(`/api/diary/log/${encodeURIComponent(logId)}`);
}

export async function apiGetEmployeeLogs(empName: string): Promise<{ logs: WorkLog[]; empName: string }> {
  const res = await api.get<{ logs: WorkLog[]; empName: string }>(
    `/api/diary/employee-logs?name=${encodeURIComponent(empName)}`
  );
  return res.data;
}
