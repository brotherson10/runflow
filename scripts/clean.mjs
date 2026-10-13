// Remove as pastas indicadas (relativas à pasta atual). Usado pelos scripts de build.
import { rmSync } from "node:fs";

for (const dir of process.argv.slice(2)) {
  rmSync(dir, { recursive: true, force: true });
}
