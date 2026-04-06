import { z } from 'zod';
// -- Bug Tracking --
export const BugStatusSchema = z.enum(['open', 'in_progress', 'resolved']);
export const BugSeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export const BugEntrySchema = z.object({
    id: z.string().regex(/^BUG-\d+$/, 'id must match BUG-NNN format'),
    title: z.string(),
    description: z.string(),
    status: BugStatusSchema,
    severity: BugSeveritySchema,
    file: z.string().nullable().optional(),
    line: z.number().nullable().optional(),
    labels: z.array(z.string()),
    reported_by_session: z.string().nullable().optional(),
    created: z.string().datetime({ message: 'created must be ISO 8601 datetime' }),
    updated: z.string().datetime({ message: 'updated must be ISO 8601 datetime' }),
    resolution: z.string().nullable().optional(),
    resolved_by_session: z.string().nullable().optional(),
});
export const BugsFileSchema = z.object({
    bugs: z.array(BugEntrySchema),
});
//# sourceMappingURL=types.js.map