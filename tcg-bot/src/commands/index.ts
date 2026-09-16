import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Command } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Load every command module in this folder.
 * Each command file default-exports a Command. This file itself is skipped.
 */
export async function loadCommands(): Promise<Command[]> {
  const files = readdirSync(here).filter(
    (file) =>
      (file.endsWith('.ts') || file.endsWith('.js')) &&
      !file.startsWith('index.'),
  );

  const commands: Command[] = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(here, file)).href);
    commands.push(mod.default as Command);
  }
  return commands;
}
