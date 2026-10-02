// Prompts are free text and sometimes contain pasted secrets. Anything whyline
// prints or emits as JSON passes through here first. This is best-effort, not a
// guarantee: it catches well-known token shapes, not arbitrary secrets.
const PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic style keys
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g, // AWS access key id
  /xox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
];
const ASSIGNMENT = /\b((?:api[_-]?key|secret|token|passwd|password)\s*[=:]\s*)(['"]?)[^\s'"]{6,}\2/gi;

/** @param {string} text */
export function redact(text) {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, '[redacted]');
  return out.replace(ASSIGNMENT, '$1[redacted]');
}
