import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
const CONTEXT_MAX_LENGTH = 4000;
const CONTEXT_FILTER_ROLE_KEY = '__context_filter_role';
const ALWAYS_INCLUDED_SECTION_KEYWORDS = ['purpose', 'tech stack', 'conventions', 'constraints'];
const ARCHITECTURE_SECTION_KEYWORD = 'architecture';
const COMPLETED_WORK_SECTION_KEYWORD = 'completed work';
function truncateContext(context, maxLength) {
    if (context.length <= maxLength) {
        return context;
    }
    return context.slice(0, maxLength) + '\n\n(truncated)';
}
function inferRoleFromPromptPath(promptPath) {
    const match = promptPath.match(/(?:^|\/)roles\/([^/]+)\//i);
    return match?.[1]?.toLowerCase() ?? '';
}
function getContextPreamble(context) {
    const firstSectionIndex = context.search(/^##\s+/m);
    if (firstSectionIndex === -1) {
        return context.trim();
    }
    return context.slice(0, firstSectionIndex).trim();
}
function extractKeywords(text) {
    return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}
function formatContextSection(section) {
    return section.content
        ? `## ${section.header}\n\n${section.content}`
        : `## ${section.header}`;
}
function hasKeywordOverlap(header, taskKeywords) {
    const headerKeywords = extractKeywords(header);
    for (const keyword of headerKeywords) {
        if (taskKeywords.has(keyword)) {
            return true;
        }
    }
    return false;
}
function shouldAlwaysIncludeSection(header) {
    const normalizedHeader = header.toLowerCase();
    return ALWAYS_INCLUDED_SECTION_KEYWORDS.some(keyword => normalizedHeader.includes(keyword));
}
function shouldIncludeRoleSection(header, role) {
    const normalizedHeader = header.toLowerCase();
    if ((role === 'builder' || role === 'planner') &&
        normalizedHeader.includes(ARCHITECTURE_SECTION_KEYWORD)) {
        return true;
    }
    if (role === 'reviewer' && normalizedHeader.includes(COMPLETED_WORK_SECTION_KEYWORD)) {
        return true;
    }
    return false;
}
function buildTaskKeywordSet(taskContext) {
    const values = Object.entries(taskContext)
        .filter(([key]) => key !== CONTEXT_FILTER_ROLE_KEY)
        .map(([, value]) => value)
        .join(' ');
    return extractKeywords(values);
}
function buildFilteredContext(context, sections, taskContext) {
    const role = taskContext[CONTEXT_FILTER_ROLE_KEY]?.toLowerCase() ?? '';
    const taskKeywords = buildTaskKeywordSet(taskContext);
    const filteredSections = sections.filter(section => shouldAlwaysIncludeSection(section.header) ||
        shouldIncludeRoleSection(section.header, role) ||
        hasKeywordOverlap(section.header, taskKeywords));
    if (filteredSections.length === 0) {
        return '';
    }
    const preamble = getContextPreamble(context);
    return [preamble, ...filteredSections.map(formatContextSection)]
        .filter(part => part.length > 0)
        .join('\n\n')
        .trim();
}
function parseContextSections(context) {
    const headingRegex = /^##\s+(.+)$/gm;
    const matches = Array.from(context.matchAll(headingRegex));
    return matches.map((match, index) => {
        const header = match[1].trim();
        const contentStart = (match.index ?? 0) + match[0].length;
        const contentEnd = index + 1 < matches.length ? (matches[index + 1].index ?? context.length) : context.length;
        const content = context.slice(contentStart, contentEnd).trim();
        return { header, content };
    });
}
function filterContextSections(context, taskContext, maxLength = CONTEXT_MAX_LENGTH) {
    if (context.length <= maxLength) {
        return context;
    }
    const sections = parseContextSections(context);
    if (sections.length === 0) {
        return truncateContext(context, maxLength);
    }
    const filteredContext = buildFilteredContext(context, sections, taskContext);
    if (!filteredContext) {
        return truncateContext(context, maxLength);
    }
    return truncateContext(filteredContext, maxLength);
}
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
        projectContext = filterContextSections(projectContext, {
            ...taskContext,
            [CONTEXT_FILTER_ROLE_KEY]: inferRoleFromPromptPath(promptPath),
        });
    }
    composed = composed.replaceAll('{{project_context}}', projectContext);
    composed = composed.replace(/\{\{(\w+)\}\}/g, (match, key) => taskContext[key] ?? match);
    return composed;
}
//# sourceMappingURL=prompt-composer.js.map