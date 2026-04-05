import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { withLock } from '../session/lock.js';
export class ContextManager {
    projectDir;
    contextPath;
    constructor(projectDir) {
        this.projectDir = projectDir;
        this.contextPath = path.join(projectDir, '.invoke', 'context.md');
    }
    async get(maxLength) {
        if (!existsSync(this.contextPath)) {
            return null;
        }
        let content = await readFile(this.contextPath, 'utf-8');
        if (maxLength && content.length > maxLength) {
            content = content.slice(0, maxLength) + '\n\n(truncated)';
        }
        return content;
    }
    exists() {
        return existsSync(this.contextPath);
    }
    async initialize(content) {
        await withLock(this.contextPath, async () => {
            await writeFile(this.contextPath, content);
        });
    }
    async updateSection(sectionName, content, mode) {
        await withLock(this.contextPath, async () => {
            const current = await this.get();
            if (!current) {
                throw new Error('No context.md exists. Call initialize() first.');
            }
            const heading = `## ${sectionName}`;
            const headingIndex = current.indexOf(heading);
            if (headingIndex === -1) {
                throw new Error(`Section '${sectionName}' not found in context.md`);
            }
            const afterHeading = headingIndex + heading.length;
            const nextHeadingIndex = current.indexOf('\n## ', afterHeading);
            const sectionEnd = nextHeadingIndex === -1 ? current.length : nextHeadingIndex;
            if (mode === 'replace') {
                const updated = current.slice(0, afterHeading) +
                    '\n\n' + content + '\n' +
                    current.slice(sectionEnd);
                await writeFile(this.contextPath, updated);
            }
            else {
                const updated = current.slice(0, sectionEnd) +
                    content + '\n' +
                    current.slice(sectionEnd);
                await writeFile(this.contextPath, updated);
            }
        });
    }
}
//# sourceMappingURL=context.js.map