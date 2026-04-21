/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OLLAMA_BASE?: string;
  readonly VITE_OLLAMA_MODEL?: string;
  readonly VITE_OLLAMA_ENABLED?: string;
}
