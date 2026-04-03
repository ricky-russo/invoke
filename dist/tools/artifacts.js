import { readFile, writeFile, mkdir, readdir, unlink } from 'fs/promises';
import path from 'path';
export class ArtifactManager {
    baseDir;
    constructor(projectDir) {
        this.baseDir = path.join(projectDir, '.invoke');
    }
    async save(stage, filename, content) {
        const dir = path.join(this.baseDir, stage);
        await mkdir(dir, { recursive: true });
        const filePath = path.join(dir, filename);
        await writeFile(filePath, content);
        return filePath;
    }
    async read(stage, filename) {
        const filePath = path.join(this.baseDir, stage, filename);
        return readFile(filePath, 'utf-8');
    }
    async list(stage) {
        const dir = path.join(this.baseDir, stage);
        try {
            return await readdir(dir);
        }
        catch {
            return [];
        }
    }
    async delete(stage, filename) {
        const filePath = path.join(this.baseDir, stage, filename);
        await unlink(filePath);
    }
}
//# sourceMappingURL=artifacts.js.map