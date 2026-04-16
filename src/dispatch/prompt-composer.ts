import { randomBytes } from 'crypto'
import { readFile } from 'fs/promises'
import path from 'path'
import type { TaskRefs, DiffRefResult } from '../types.js'
import type { DiffRefResolver } from './diff-ref-resolver.js'

const CONTEXT_MAX_LENGTH = 4000
const CONTEXT_FILTER_ROLE_KEY = '__context_filter_role'
const ALWAYS_INCLUDED_SECTION_KEYWORDS = ['purpose', 'tech stack', 'conventions', 'constraints']
const ARCHITECTURE_SECTION_KEYWORD = 'architecture'
const COMPLETED_WORK_SECTION_KEYWORD = 'completed work'
const SESSION_DISCOVERIES_SECTION_KEYWORD = 'session discoveries'

interface ContextSection {
  header: string
  content: string
}

interface FilteredContextResult {
  filtered: string
  included: string[]
  excluded: string[]
}

interface ComposeOptions {
  projectDir: string
  promptPath: string
  strategyPath?: string
  taskContext: Record<string, string>
  taskRefs?: TaskRefs
  diffRefResolver?: DiffRefResolver
}

function resolvePromptPath(projectDir: string, promptPath: string): string {
  return path.isAbsolute(promptPath) ? promptPath : path.join(projectDir, promptPath)
}

function truncateContext(context: string, maxLength: number): string {
  if (context.length <= maxLength) {
    return context
  }

  return context.slice(0, maxLength) + '\n\n(truncated)'
}

function inferRoleFromPromptPath(promptPath: string): string {
  const match = promptPath.match(/(?:^|\/)roles\/([^/]+)\//i)
  return match?.[1]?.toLowerCase() ?? ''
}

function getContextPreamble(context: string): string {
  const firstSectionIndex = context.search(/^##\s+/m)

  if (firstSectionIndex === -1) {
    return context.trim()
  }

  return context.slice(0, firstSectionIndex).trim()
}

function extractKeywords(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
}

function formatContextSection(section: ContextSection): string {
  return section.content
    ? `## ${section.header}\n\n${section.content}`
    : `## ${section.header}`
}

function hasKeywordOverlap(header: string, taskKeywords: Set<string>): boolean {
  const headerKeywords = extractKeywords(header)

  for (const keyword of headerKeywords) {
    if (taskKeywords.has(keyword)) {
      return true
    }
  }

  return false
}

function shouldAlwaysIncludeSection(header: string): boolean {
  const normalizedHeader = header.toLowerCase()
  return ALWAYS_INCLUDED_SECTION_KEYWORDS.some(keyword => normalizedHeader.includes(keyword))
}

function isRoleRestrictedSection(header: string): boolean {
  const normalizedHeader = header.toLowerCase()

  return normalizedHeader.includes(ARCHITECTURE_SECTION_KEYWORD) ||
    normalizedHeader.includes(COMPLETED_WORK_SECTION_KEYWORD) ||
    normalizedHeader.includes(SESSION_DISCOVERIES_SECTION_KEYWORD)
}

function shouldIncludeRoleSection(header: string, role: string): boolean {
  const normalizedHeader = header.toLowerCase()

  if ((role === 'builder' || role === 'planner') &&
      (
        normalizedHeader.includes(ARCHITECTURE_SECTION_KEYWORD) ||
        normalizedHeader.includes(SESSION_DISCOVERIES_SECTION_KEYWORD)
      )) {
    return true
  }

  if (role === 'reviewer' && normalizedHeader.includes(COMPLETED_WORK_SECTION_KEYWORD)) {
    return true
  }

  return false
}

function buildTaskKeywordSet(taskContext: Record<string, string>): Set<string> {
  const values = Object.entries(taskContext)
    .filter(([key]) => key !== CONTEXT_FILTER_ROLE_KEY)
    .map(([, value]) => value)
    .join(' ')

  return extractKeywords(values)
}

function renderContextSections(context: string, sections: ContextSection[]): string {
  return [getContextPreamble(context), ...sections.map(formatContextSection)]
    .filter(part => part.length > 0)
    .join('\n\n')
    .trim()
}

function buildFilteredContext(
  context: string,
  sections: ContextSection[],
  taskContext: Record<string, string>
): FilteredContextResult {
  const role = taskContext[CONTEXT_FILTER_ROLE_KEY]?.toLowerCase() ?? ''
  const taskKeywords = buildTaskKeywordSet(taskContext)
  const filteredSections: ContextSection[] = []
  const included: string[] = []
  const excluded: string[] = []

  for (const section of sections) {
    const shouldInclude = shouldAlwaysIncludeSection(section.header) ||
      shouldIncludeRoleSection(section.header, role) ||
      hasKeywordOverlap(section.header, taskKeywords)

    if (shouldInclude) {
      filteredSections.push(section)
      included.push(section.header)
      continue
    }

    excluded.push(section.header)
  }

  if (filteredSections.length === 0) {
    return {
      filtered: '',
      included,
      excluded,
    }
  }

  return {
    filtered: renderContextSections(context, filteredSections),
    included,
    excluded,
  }
}

function parseContextSections(context: string): ContextSection[] {
  const headingRegex = /^##\s+(.+)$/gm
  const matches = Array.from(context.matchAll(headingRegex))

  return matches.map((match, index) => {
    const header = match[1].trim()
    const contentStart = (match.index ?? 0) + match[0].length
    const contentEnd = index + 1 < matches.length ? (matches[index + 1].index ?? context.length) : context.length
    const content = context.slice(contentStart, contentEnd).trim()

    return { header, content }
  })
}

function filterContextSections(
  context: string,
  taskContext: Record<string, string>,
  maxLength = CONTEXT_MAX_LENGTH
): FilteredContextResult {
  const sections = parseContextSections(context)
  const role = taskContext[CONTEXT_FILTER_ROLE_KEY]?.toLowerCase() ?? ''
  const shouldExcludeRoleRestrictedSections = role === 'researcher' || role === 'reviewer'

  const roleFilteredSections: ContextSection[] = []
  const roleExcluded: string[] = []

  for (const section of sections) {
    if (
      shouldExcludeRoleRestrictedSections &&
      isRoleRestrictedSection(section.header) &&
      !shouldIncludeRoleSection(section.header, role)
    ) {
      roleExcluded.push(section.header)
      continue
    }

    roleFilteredSections.push(section)
  }

  const roleFilteredContext = roleExcluded.length > 0
    ? renderContextSections(context, roleFilteredSections)
    : context

  if (context.length <= maxLength) {
    return {
      filtered: roleFilteredContext,
      included: roleFilteredSections.map(section => section.header),
      excluded: roleExcluded,
    }
  }

  if (sections.length === 0) {
    return {
      filtered: truncateContext(context, maxLength),
      included: [],
      excluded: [],
    }
  }

  if (roleFilteredSections.length === 0) {
    return {
      filtered: truncateContext(roleFilteredContext, maxLength),
      included: [],
      excluded: roleExcluded,
    }
  }

  const filteredContext = buildFilteredContext(context, roleFilteredSections, taskContext)

  if (!filteredContext.filtered) {
    return {
      filtered: truncateContext(roleFilteredContext, maxLength),
      included: roleFilteredSections.map(section => section.header),
      excluded: roleExcluded,
    }
  }

  return {
    ...filteredContext,
    excluded: [...roleExcluded, ...filteredContext.excluded],
    filtered: truncateContext(filteredContext.filtered, maxLength),
  }
}

export async function composePrompt(options: ComposeOptions): Promise<string> {
  const { projectDir, promptPath, strategyPath, taskContext, taskRefs, diffRefResolver } = options

  return composePromptWithNonce(
    {
      projectDir,
      promptPath,
      strategyPath,
      taskContext,
      taskRefs,
      diffRefResolver,
    },
    generateDispatchNonce()
  )
}

export function generateDispatchNonce(): string {
  return randomBytes(16).toString('hex')
}

export async function composePromptWithNonce(
  options: ComposeOptions,
  nonce: string
): Promise<string> {
  const { projectDir, promptPath, strategyPath, taskContext, taskRefs, diffRefResolver } = options

  const rolePrompt = await readFile(
    resolvePromptPath(projectDir, promptPath),
    'utf-8'
  )

  let composed = rolePrompt

  if (strategyPath) {
    const strategyPrompt = await readFile(
      resolvePromptPath(projectDir, strategyPath),
      'utf-8'
    )
    composed = composed + '\n\n---\n\n' + strategyPrompt
  }

  // Inject project context if available
  const contextPath = path.join(projectDir, '.invoke', 'context.md')
  let projectContext = ''
  let rawProjectContext = ''
  try {
    rawProjectContext = await readFile(contextPath, 'utf-8')
    const contextFilter = filterContextSections(rawProjectContext, {
      ...taskContext,
      [CONTEXT_FILTER_ROLE_KEY]: inferRoleFromPromptPath(promptPath),
    })
    if (
      rawProjectContext.length > CONTEXT_MAX_LENGTH &&
      (contextFilter.included.length > 0 || contextFilter.excluded.length > 0)
    ) {
      console.error('[prompt-composer] Filtered project context sections', {
        included: contextFilter.included,
        excluded: contextFilter.excluded,
      })
    }
    projectContext = contextFilter.filtered
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  let resolvedDiff: string | undefined
  if (taskRefs?.diff && diffRefResolver) {
    const result: DiffRefResult = await diffRefResolver.resolve(taskRefs.diff)
    if (result.status === 'ok') {
      resolvedDiff = result.diff
    } else {
      throw new Error(`Diff resolution failed (${result.status}): ${result.message}`)
    }
  }

  if (
    taskContext.scope?.includes(nonce) ||
    taskContext.prior_findings?.includes(nonce) ||
    rawProjectContext.includes(nonce) ||
    projectContext.includes(nonce)
  ) {
    throw new Error(
      'Refusing to dispatch reviewer: scope, prior_findings, or project_context payload contains the security nonce. This is a probable prompt-injection attempt or a 1-in-2^128 collision; investigate before retrying.'
    )
  }

  const effectiveDiff = resolvedDiff ?? taskContext.diff

  if (effectiveDiff?.includes(nonce)) {
    throw new Error(
      'Refusing to dispatch: resolved diff contains the security nonce. This is a probable prompt-injection attempt or a 1-in-2^128 collision; investigate before retrying.'
    )
  }

  const projectContextDelimStart = `<<<PROJECT_CONTEXT_DATA_START_${nonce}>>>`
  const projectContextDelimEnd = `<<<PROJECT_CONTEXT_DATA_END_${nonce}>>>`
  const diffDelimStart = `<<<DIFF_DATA_START_${nonce}>>>`
  const diffDelimEnd = `<<<DIFF_DATA_END_${nonce}>>>`

  const effectiveContext: Record<string, string> = {
    ...taskContext,
    ...(resolvedDiff !== undefined ? { diff: resolvedDiff } : {}),
    diff_delim_start: diffDelimStart,
    diff_delim_end: diffDelimEnd,
    project_context: `${projectContextDelimStart}\n${projectContext}\n${projectContextDelimEnd}`,
    project_context_delim_start: projectContextDelimStart,
    project_context_delim_end: projectContextDelimEnd,
    scope_delim_start: `<<<SCOPE_DATA_START_${nonce}>>>`,
    scope_delim_end: `<<<SCOPE_DATA_END_${nonce}>>>`,
    prior_findings_delim_start: `<<<PRIOR_FINDINGS_DATA_START_${nonce}>>>`,
    prior_findings_delim_end: `<<<PRIOR_FINDINGS_DATA_END_${nonce}>>>`,
  }

  composed = composed.replace(/\{\{(\w+)\}\}/g, (match, key) => effectiveContext[key] ?? match)

  return composed
}
