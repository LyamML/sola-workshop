import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// strictPort : un port pris fait échouer Vite au lieu de le décaler d'un cran
// sans rien dire. Servie sur 5178, la console ne serait plus l'origine que le
// serveur autorise, et la connexion échouerait sans raison visible.
// `vite preview` hérite du refus, pas du port.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  preview: { port: 5174 },
});
