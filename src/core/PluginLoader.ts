import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SwissPlugin } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class PluginLoader {
  private internalPluginsDir: string;
  private localPluginsDir: string;

  constructor() {
    this.internalPluginsDir = path.resolve(__dirname, '../plugins');
    this.localPluginsDir = path.resolve(process.cwd(), '.swiss/plugins');
  }

  async loadPlugin(name: string): Promise<SwissPlugin | null> {
    const pluginPath = this.getPluginPath(name);
    
    if (!pluginPath) return null;

    try {
      const module = await import(`file://${pluginPath}`);
      return {
        name: module.name || name,
        description: module.description || '',
        default: module.default,
        configFields: module.configFields || [],
      };
    } catch (error) {
      console.error(`Error loading plugin "${name}":`, error);
      return null;
    }
  }

  private getPluginPath(name: string): string | null {
    const extensions = ['.js', '.tsx', '.ts'];
    const dirs = [this.localPluginsDir, this.internalPluginsDir];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      
      // 1. Check for single file plugin (e.g. plugins/my-plugin.tsx)
      for (const ext of extensions) {
        const fullPath = path.join(dir, `${name}${ext}`);
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      }

      // 2. Check for folder-based plugin (e.g. plugins/my-plugin/index.tsx)
      const folderPath = path.join(dir, name);
      if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {
        for (const ext of extensions) {
          const indexPath = path.join(folderPath, `index${ext}`);
          if (fs.existsSync(indexPath)) {
            return indexPath;
          }
        }
      }
    }

    return null;
  }

  async listPlugins(): Promise<string[]> {
    const plugins = new Set<string>();
    const dirs = [this.localPluginsDir, this.internalPluginsDir];
    const extensions = ['.js', '.tsx', '.ts'];

    for (const dir of dirs) {
      if (fs.existsSync(dir)) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const f = entry.name;
            if (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')) {
              plugins.add(path.parse(f).name);
            }
          } else if (entry.isDirectory()) {
            const folderName = entry.name;
            const folderPath = path.join(dir, folderName);
            const hasIndex = extensions.some(ext => 
              fs.existsSync(path.join(folderPath, `index${ext}`))
            );
            if (hasIndex) {
              plugins.add(folderName);
            }
          }
        }
      }
    }
    
    return Array.from(plugins);
  }
}
