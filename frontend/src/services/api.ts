/**
 * Axios client pre-configured for the Flask backend.
 * Automatically injects the session JWT from localStorage.
 */

import axios from "axios";
import type { AnnualSummaryResponse } from "../types";
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

// Normalise errors; on 401 attempt a single role-refresh then retry
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config as any;
    if (err.response?.status === 401 && !config._retry) {
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
    const data = err.response?.data ?? {};
    const normalised = new Error(data.error ?? err.message ?? "網路錯誤") as any;
    normalised.response = err.response;
    throw normalised;
  }
);

export async function apiGetAnnualSummary(year?: string): Promise<AnnualSummaryResponse> {
  const params = year ? `?year=${encodeURIComponent(year)}` : "";
  const res = await api.get<AnnualSummaryResponse>(`/api/scoring/annual-summary${params}`);
  return res.data;
}
