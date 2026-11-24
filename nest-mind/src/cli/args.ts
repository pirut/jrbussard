/** Tiny argv parser: `--flag`, `--key value`, `--key=value`. */
export function parseArgs(argv: string[]): { flags: Record<string, string | true>; rest: string[] } {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    if (eq > 0) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[a.slice(2)] = next;
      i++;
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return { flags, rest };
}

export function str(v: string | true | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function fatal(msg: string): never {
  console.error(msg);
  process.exit(1);
}
