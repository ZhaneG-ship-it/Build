/**
 * A fresh clone has no .env (it is gitignored, since it holds secrets), but
 * Prisma needs DATABASE_URL before anything else will run. This copies the
 * checked-in example across on first run and leaves an existing .env alone.
 */
import { existsSync, copyFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists — leaving it alone.');
} else if (existsSync('.env.example')) {
  copyFileSync('.env.example', '.env');
  console.log('Created .env from .env.example.');
  console.log('Set ANTHROPIC_API_KEY in it to enable the Claude analysis layer.');
} else {
  console.error('No .env and no .env.example found.');
  process.exit(1);
}
