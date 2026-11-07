import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";
import { Landing } from "./landing/Landing";
import { SignIn } from "./pages/SignIn";
import { Overview } from "./pages/Overview";
import { NewAgent } from "./pages/NewAgent";
import { Approval } from "./pages/Approval";
import { Approvals } from "./pages/Approvals";
import { AgentPage } from "./pages/AgentPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<SignIn />} />
        <Route path="/app" element={<Overview />} />
        <Route path="/app/agents/new" element={<NewAgent />} />
        <Route path="/app/approvals" element={<Approvals />} />
        <Route path="/app/approvals/:id" element={<Approval />} />
        <Route path="/app/agents/:id" element={<AgentPage />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
