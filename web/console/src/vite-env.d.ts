/// <reference types="vite/client" />

/**
 * Adresse du serveur de bord. Déclarée ici plutôt que lue à l'aveugle : une
 * faute de frappe dans le nom de la variable se voit à la compilation.
 */
interface ImportMetaEnv {
  /** Serveur de bord. Défaut : http://localhost:5175 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
