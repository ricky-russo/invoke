import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { parse, stringify } from 'yaml'
import type { InvokeConfig, ProviderEntry, StrategyConfig } from '../types.js'

interface AddRoleOperation {
  operation: 'add_role'
  role: string
  subrole: string
  config: {
    prompt: string
    providers: ProviderEntry[]
  }
}

interface RemoveRoleOperation {
  operation: 'remove_role'
  role: string
  subrole: string
}

interface AddStrategyOperation {
  operation: 'add_strategy'
  strategy: string
  config: StrategyConfig
}

interface RemoveStrategyOperation {
  operation: 'remove_strategy'
  strategy: string
}

interface UpdateSettingsOperation {
  operation: 'update_settings'
  settings: Record<string, unknown>
}

export type ConfigOperation =
  | AddRoleOperation
  | RemoveRoleOperation
  | AddStrategyOperation
  | RemoveStrategyOperation
  | UpdateSettingsOperation

export class ConfigManager {
  private configPath: string

  constructor(private projectDir: string) {
    this.configPath = path.join(projectDir, '.invoke', 'pipeline.yaml')
  }

  async execute(op: ConfigOperation): Promise<InvokeConfig> {
    const raw = await this.readRaw()

    switch (op.operation) {
      case 'add_role':
        return this.addRole(raw, op)
      case 'remove_role':
        return this.removeRole(raw, op)
      case 'add_strategy':
        return this.addStrategy(raw, op)
      case 'remove_strategy':
        return this.removeStrategy(raw, op)
      case 'update_settings':
        return this.updateSettings(raw, op)
    }
  }

  private async addRole(raw: any, op: AddRoleOperation): Promise<InvokeConfig> {
    if (!raw.roles[op.role]) {
      raw.roles[op.role] = {}
    }
    if (raw.roles[op.role][op.subrole]) {
      throw new Error(`Role ${op.role}.${op.subrole} already exists`)
    }

    raw.roles[op.role][op.subrole] = {
      prompt: op.config.prompt,
      providers: op.config.providers,
    }

    return this.writeAndReload(raw)
  }

  private async removeRole(raw: any, op: RemoveRoleOperation): Promise<InvokeConfig> {
    if (!raw.roles[op.role]?.[op.subrole]) {
      throw new Error(`Role ${op.role}.${op.subrole} not found`)
    }

    delete raw.roles[op.role][op.subrole]

    return this.writeAndReload(raw)
  }

  private async addStrategy(raw: any, op: AddStrategyOperation): Promise<InvokeConfig> {
    if (raw.strategies[op.strategy]) {
      throw new Error(`Strategy ${op.strategy} already exists`)
    }

    raw.strategies[op.strategy] = op.config

    return this.writeAndReload(raw)
  }

  private async removeStrategy(raw: any, op: RemoveStrategyOperation): Promise<InvokeConfig> {
    if (!raw.strategies[op.strategy]) {
      throw new Error(`Strategy ${op.strategy} not found`)
    }

    delete raw.strategies[op.strategy]

    return this.writeAndReload(raw)
  }

  private async updateSettings(raw: any, op: UpdateSettingsOperation): Promise<InvokeConfig> {
    raw.settings = { ...raw.settings, ...op.settings }

    return this.writeAndReload(raw)
  }

  private async readRaw(): Promise<any> {
    const content = await readFile(this.configPath, 'utf-8')
    return parse(content)
  }

  private async writeAndReload(raw: any): Promise<InvokeConfig> {
    await writeFile(this.configPath, stringify(raw))

    // Re-read through the normal config loader to validate and normalize
    const { loadConfig } = await import('../config.js')
    return loadConfig(this.projectDir)
  }
}
