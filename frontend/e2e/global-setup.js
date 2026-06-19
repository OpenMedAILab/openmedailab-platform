import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export default async function globalSetup() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "../..");
  mkdirSync(path.join(root, "frontend/e2e/.state"), { recursive: true });
  execFileSync(path.join(root, ".venv/bin/python"), ["manage.py", "migrate", "--noinput"], {
    cwd: root,
    env: { ...process.env, OPENMEDAILAB_E2E: "1" },
    stdio: "inherit",
  });
  execFileSync(path.join(root, ".venv/bin/python"), ["manage.py", "seed_e2e_data", "--reset"], {
    cwd: root,
    env: { ...process.env, OPENMEDAILAB_E2E: "1" },
    stdio: "inherit",
  });
}
