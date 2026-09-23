import { Navigate, Route, Routes } from "react-router-dom";
import { AppBar } from "./components/AppBar";
import { CrewPage } from "./pages/CrewPage";
import { RegistrePage } from "./pages/RegistrePage";
import { ResidentPage } from "./pages/ResidentPage";
import { Session } from "./session";

export default function App() {
  return (
    // Aucun écran avant la session : la porte est ici, tout en haut, plutôt
    // que répétée page par page où l'oubli d'une route l'ouvrirait en grand.
    <Session
      enfants={
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
      }
    />
  );
}
