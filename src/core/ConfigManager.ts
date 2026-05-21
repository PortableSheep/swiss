import fs from 'fs';
import path from 'path';
import os from 'os';

export class ConfigManager {
  private configPath: string;

  constructor() {
    this.configPath = path.join(os.homedir(), '.swiss.json');
  }

  get(plugin: string): Record<string, any> {
    if (!fs.existsSync(this.configPath)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      return data[plugin] || {};
    } catch {
      return {};
    }
  }

  set(plugin: string, config: Record<string, any>): void {
    let data: Record<string, any> = {};
    if (fs.existsSync(this.configPath)) {
      try {
        data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      } catch {}
    }
    data[plugin] = { ...(data[plugin] || {}), ...config };
    fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }
}
