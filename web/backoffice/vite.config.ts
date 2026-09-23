import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// strictPort, pour la même raison que la console : décalé sur un autre port, le
// backoffice ne serait plus l'origine que le serveur autorise, et la connexion
// échouerait sans raison visible. `vite preview` hérite du refus, pas du port.
export default defineConfig({
  plugins: [react()],
  server: { port: 5176, strictPort: true },
  preview: { port: 5176 },
});
