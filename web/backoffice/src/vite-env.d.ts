/// <reference types="vite/client" />

/**
 * L'adresse que le backoffice doit connaître. Déclarée ici plutôt que lue à
 * l'aveugle : une faute de frappe dans un nom de variable se voit à la
 * compilation, pas à l'exécution.
 */
interface ImportMetaEnv {
  /** Serveur de bord. Défaut : http://localhost:5175 */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
