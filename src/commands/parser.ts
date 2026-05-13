export interface ParsedCommand {
  isCommand: boolean;
  name?: string;
  args: string[];
  raw: string;
}

export function parseCommand(text: string, prefix = "/"): ParsedCommand {
  const raw = text.trim();
  if (!raw.startsWith(prefix) || raw.length === prefix.length) {
    return { isCommand: false, args: [], raw: text };
  }
  const [head = "", ...args] = raw.slice(prefix.length).split(/\s+/);
  if (!head) return { isCommand: false, args: [], raw: text };
  return {
    isCommand: true,
    name: head.toLowerCase(),
    args,
    raw: text,
  };
}
