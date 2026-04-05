import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useLiff } from "./hooks/useLiff";
import Admin from "./pages/Admin";
import Bind from "./pages/Bind";
import Dashboard from "./pages/Dashboard";
import ManagerBatch from "./pages/ManagerBatch";
import Score from "./pages/Score";
import SeasonScore from "./pages/SeasonScore";
import SelfScore from "./pages/SelfScore";
import SysAdmin from "./pages/SysAdmin";
import WorkDiary from "./pages/WorkDiary";
import "./styles.css";

/** Routes that require LINE authentication */
function AuthenticatedRoutes() {
  const { ready, needBind, error } = useLiff();

  if (needBind) {
    return <Navigate to="/bind" replace />;
  }

  if (error) {
    return (
      <div className="page-center">
        <div className="card">
          <p className="error">⚠️ {error}</p>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            重新整理
          </button>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="page-center">
        <div className="spinner" />
        <p>初始化中...</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/score" element={<Score />} />
      <Route path="/self-score" element={<SelfScore />} />
      <Route path="/season-score" element={<SeasonScore />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/manager-batch" element={<ManagerBatch />} />
      <Route path="/sysadmin" element={<SysAdmin />} />
      <Route path="/diary" element={<WorkDiary />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* /bind does NOT require LIFF auth — it's the entry point for new users */}
        <Route path="/bind" element={<Bind />} />
        <Route path="/*" element={<AuthenticatedRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}
