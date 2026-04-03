import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
const CONTEXT_MAX_LENGTH = 4000;
export async function composePrompt(options) {
    const { projectDir, promptPath, strategyPath, taskContext } = options;
    const rolePrompt = await readFile(path.join(projectDir, promptPath), 'utf-8');
    let composed = rolePrompt;
    if (strategyPath) {
        const strategyPrompt = await readFile(path.join(projectDir, strategyPath), 'utf-8');
        composed = composed + '\n\n---\n\n' + strategyPrompt;
    }
    // Inject project context if available
    const contextPath = path.join(projectDir, '.invoke', 'context.md');
    let projectContext = '';
    if (existsSync(contextPath)) {
        projectContext = await readFile(contextPath, 'utf-8');
        if (projectContext.length > CONTEXT_MAX_LENGTH) {
            projectContext = projectContext.slice(0, CONTEXT_MAX_LENGTH) + '\n\n(truncated)';
        }
    }
    composed = composed.replaceAll('{{project_context}}', projectContext);
    for (const [key, value] of Object.entries(taskContext)) {
        composed = composed.replaceAll(`{{${key}}}`, value);
    }
    return composed;
}
//# sourceMappingURL=prompt-composer.js.map