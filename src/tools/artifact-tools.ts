import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ArtifactManager } from './artifacts.js'

export function registerArtifactTools(server: McpServer, artifactManager: ArtifactManager): void {
  server.registerTool(
    'invoke_save_artifact',
    {
      description: 'Save a pipeline artifact (spec, plan, review) to the .invoke/ directory.',
      inputSchema: z.object({
        stage: z.string().describe('Stage directory (e.g. specs, plans, reviews, specs/research)'),
        filename: z.string().describe('Filename to save'),
        content: z.string().describe('File content'),
      }),
    },
    async ({ stage, filename, content }) => {
      const filePath = await artifactManager.save(stage, filename, content)
      return {
        content: [{ type: 'text', text: JSON.stringify({ saved: filePath }) }],
      }
    }
  )

  server.registerTool(
    'invoke_read_artifact',
    {
      description: 'Read a pipeline artifact from the .invoke/ directory.',
      inputSchema: z.object({
        stage: z.string().describe('Stage directory (e.g. specs, plans, reviews)'),
        filename: z.string().describe('Filename to read'),
      }),
    },
    async ({ stage, filename }) => {
      try {
        const content = await artifactManager.read(stage, filename)
        return {
          content: [{ type: 'text', text: content }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Artifact not found: ${stage}/${filename}` }],
          isError: true,
        }
      }
    }
  )
}
