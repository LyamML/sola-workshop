import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// Le modèle de langage tourne dans la cabine, sur la même machine que la borne.
// La page l'atteint par sa propre origine : pas de CORS à ouvrir côté Ollama,
// et l'adresse du modèle ne se retrouve pas dans le code du navigateur.
const ollama: Record<string, ProxyOptions> = {
  "/ollama": {
    target: "http://127.0.0.1:11434",
    changeOrigin: true,
    rewrite: (chemin) => chemin.replace(/^\/ollama/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  // Web Bluetooth exige un contexte sécurisé : localhost en fait partie,
  // donc le serveur de développement suffit, sans certificat.
  server: { port: 5173, proxy: ollama },
  preview: { port: 5173, proxy: ollama },
});
