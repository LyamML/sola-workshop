import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Web Bluetooth exige un contexte sécurisé : localhost en fait partie,
  // donc le serveur de développement suffit, sans certificat.
  server: { port: 5173 },
});
