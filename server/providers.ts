// AI providers the copilot can use. Everything except Anthropic speaks the OpenAI
// chat-completions protocol, so one client covers OpenAI, Gemini, Groq and custom endpoints.
export type ProviderId = "anthropic" | "openai" | "gemini" | "groq" | "custom";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  env: string;
  baseUrl: string;
  defaultModel: string;
  keyHelp: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "anthropic", label: "Anthropic (Claude)", env: "ANTHROPIC_API_KEY", baseUrl: "", defaultModel: "claude-opus-5-5", keyHelp: "console.anthropic.com → API keys" },
  { id: "openai", label: "OpenAI", env: "OPENAI_API_KEY", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o", keyHelp: "platform.openai.com → API keys" },
  { id: "gemini", label: "Google Gemini", env: "GEMINI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.5-flash", keyHelp: "aistudio.google.com → Get API key" },
  { id: "groq", label: "Groq", env: "GROQ_API_KEY", baseUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", keyHelp: "console.groq.com → API keys" },
  { id: "custom", label: "Custom (OpenAI-compatible)", env: "", baseUrl: "", defaultModel: "", keyHelp: "Any endpoint that implements /chat/completions with tool calling, e.g. Ollama or OpenRouter" },
];

export const provider = (id: string | undefined) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
