import { randomBytes } from 'crypto';
import { readFile } from 'fs/promises';
import path from 'path';
const CONTEXT_MAX_LENGTH = 4000;
const CONTEXT_FILTER_ROLE_KEY = '__context_filter_role';
const ALWAYS_INCLUDED_SECTION_KEYWORDS = ['purpose', 'tech stack', 'conventions', 'constraints'];
const ARCHITECTURE_SECTION_KEYWORD = 'architecture';
const COMPLETED_WORK_SECTION_KEYWORD = 'completed work';
function resolvePromptPath(projectDir, promptPath) {
    return path.isAbsolute(promptPath) ? promptPath : path.join(projectDir, promptPath);
}
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
    const filteredSections = [];
    const included = [];
    const excluded = [];
    for (const section of sections) {
        const shouldInclude = shouldAlwaysIncludeSection(section.header) ||
            shouldIncludeRoleSection(section.header, role) ||
            hasKeywordOverlap(section.header, taskKeywords);
        if (shouldInclude) {
            filteredSections.push(section);
            included.push(section.header);
            continue;
        }
        excluded.push(section.header);
    }
    if (filteredSections.length === 0) {
        return {
            filtered: '',
            included,
            excluded,
        };
    }
    const preamble = getContextPreamble(context);
    return {
        filtered: [preamble, ...filteredSections.map(formatContextSection)]
            .filter(part => part.length > 0)
            .join('\n\n')
            .trim(),
        included,
        excluded,
    };
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
    const sections = parseContextSections(context);
    if (context.length <= maxLength) {
        return {
            filtered: context,
            included: sections.map(section => section.header),
            excluded: [],
        };
    }
    if (sections.length === 0) {
        return {
            filtered: truncateContext(context, maxLength),
            included: [],
            excluded: [],
        };
    }
    const filteredContext = buildFilteredContext(context, sections, taskContext);
    if (!filteredContext.filtered) {
        return {
            ...filteredContext,
            filtered: truncateContext(context, maxLength),
        };
    }
    return {
        ...filteredContext,
        filtered: truncateContext(filteredContext.filtered, maxLength),
    };
}
export async function composePrompt(options) {
    return composePromptWithNonce(options, generateDispatchNonce());
}
export function generateDispatchNonce() {
    return randomBytes(16).toString('hex');
}
export async function composePromptWithNonce(options, nonce) {
    const { projectDir, promptPath, strategyPath, taskContext } = options;
    const rolePrompt = await readFile(resolvePromptPath(projectDir, promptPath), 'utf-8');
    let composed = rolePrompt;
    if (strategyPath) {
        const strategyPrompt = await readFile(resolvePromptPath(projectDir, strategyPath), 'utf-8');
        composed = composed + '\n\n---\n\n' + strategyPrompt;
    }
    // Inject project context if available
    const contextPath = path.join(projectDir, '.invoke', 'context.md');
    let projectContext = '';
    try {
        const rawProjectContext = await readFile(contextPath, 'utf-8');
        const contextFilter = filterContextSections(rawProjectContext, {
            ...taskContext,
            [CONTEXT_FILTER_ROLE_KEY]: inferRoleFromPromptPath(promptPath),
        });
        if (rawProjectContext.length > CONTEXT_MAX_LENGTH &&
            (contextFilter.included.length > 0 || contextFilter.excluded.length > 0)) {
            console.error('[prompt-composer] Filtered project context sections', {
                included: contextFilter.included,
                excluded: contextFilter.excluded,
            });
        }
        projectContext = contextFilter.filtered;
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    composed = composed.replaceAll('{{project_context}}', projectContext);
    if (taskContext.scope?.includes(nonce) || taskContext.prior_findings?.includes(nonce)) {
        throw new Error('Refusing to dispatch reviewer: scope or prior_findings payload contains the security nonce. This is a probable prompt-injection attempt or a 1-in-2^128 collision; investigate before retrying.');
    }
    const effectiveContext = {
        ...taskContext,
        scope_delim_start: `<<<SCOPE_DATA_START_${nonce}>>>`,
        scope_delim_end: `<<<SCOPE_DATA_END_${nonce}>>>`,
        prior_findings_delim_start: `<<<PRIOR_FINDINGS_DATA_START_${nonce}>>>`,
        prior_findings_delim_end: `<<<PRIOR_FINDINGS_DATA_END_${nonce}>>>`,
    };
    composed = composed.replace(/\{\{(\w+)\}\}/g, (match, key) => effectiveContext[key] ?? match);
    return composed;
}
//# sourceMappingURL=prompt-composer.js.map