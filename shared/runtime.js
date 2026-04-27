export function getMissingEnvVars(env, requiredKeys) {
  return requiredKeys.filter((key) => !env[key] || String(env[key]).trim() === "");
}

export function formatMissingEnvMessage(missingKeys) {
  if (missingKeys.length === 0) return null;
  return `Missing required environment variables: ${missingKeys.join(", ")}. Set them in .env or your MCP/Supabase environment before starting Tweet Vault.`;
}
