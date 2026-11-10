// Client-safe: no server imports. Nonsense trigger token from a persona name: "Samantha Bell" -> "smnthbll".
export const DEFAULT_TRIGGER_PREFIX = 'chr';
export function triggerFor(name: string): string {
  const t = name.toLowerCase().replace(/[aeiou\s\W]/g, '').slice(0, 8);
  return t.length >= 4 ? t : `${DEFAULT_TRIGGER_PREFIX}${t}`;
}
