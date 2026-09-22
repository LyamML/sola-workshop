import { Navigate, Route, Routes } from "react-router-dom";
import { AppBar } from "./components/AppBar";
import { CrewPage } from "./pages/CrewPage";
import { RegistrePage } from "./pages/RegistrePage";
import { ResidentPage } from "./pages/ResidentPage";

export default function App() {
  return (
    <>
      <AppBar />
      <Routes>
        <Route path="/" element={<CrewPage />} />
        <Route path="/registre" element={<RegistrePage onglet="residents" />} />
        <Route path="/signaux" element={<RegistrePage onglet="signaux" />} />
        <Route path="/residents/:id" element={<ResidentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
