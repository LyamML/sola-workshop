/// <reference types="vite/client" />

/**
 * Les trois adresses que le backoffice doit connaître. Déclarées ici plutôt
 * que lues à l'aveugle : une faute de frappe dans un nom de variable se voit
 * à la compilation, pas à l'exécution.
 */
interface ImportMetaEnv {
  /** Serveur de bord. Défaut : http://localhost:5175 */
  readonly VITE_API_URL?: string;
  /** Console médicale, pour les liens « voir dans la console ». */
  readonly VITE_CONSOLE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
