import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'src'), { recursive: true });
for (const file of ['index.html', 'style.css', 'src/app.js', 'src/physics.js', 'src/game.js']) {
  await cp(join(root, file), join(output, file));
}
await writeFile(join(output, '.nojekyll'), '');
console.log('Static site built in dist/');
