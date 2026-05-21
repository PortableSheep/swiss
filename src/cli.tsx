#!/usr/bin/env node
import React from 'react';
import { render, Text, Box, useApp, useInput } from 'ink';
import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { PluginLoader } from './core/PluginLoader.js';
import { Header, Layout } from './components/UI.js';
import { ConfigManager } from './core/ConfigManager.js';

const program = new Command();
const loader = new PluginLoader();
const configManager = new ConfigManager();

program
  .name('swiss')
  .description('A dev-centric TUI toolkit')
  .version('1.0.0')
  .argument('[plugin]', 'Plugin to run')
  .argument('[args...]', 'Arguments for the plugin')
  .allowUnknownOption()
  .action(async (pluginName, pluginArgs, options, cmd) => {
    if (pluginName === 'generate') {
      const newPluginName = pluginArgs?.[0];
      if (!newPluginName) {
        console.error('Error: Please specify a plugin name. Usage: swiss generate <plugin-name>');
        process.exit(1);
      }
      const targetDir = path.resolve(process.cwd(), '.swiss/plugins');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const newPluginPath = path.join(targetDir, `${newPluginName}.tsx`);
      if (fs.existsSync(newPluginPath)) {
        console.error(`Error: Plugin "${newPluginName}" already exists at ${newPluginPath}`);
        process.exit(1);
      }

      const template = `import React from 'react';
import { Text, Box } from 'ink';
import { Header, Layout, Card } from '../../src/components/UI.js';
import { PluginProps } from '../../src/core/types.js';

export const name = '${newPluginName.charAt(0).toUpperCase() + newPluginName.slice(1)}';
export const description = 'Custom developer plugin for Swiss';

const ${newPluginName.charAt(0).toUpperCase() + newPluginName.slice(1)}Plugin: React.FC<PluginProps> = ({ args, config }) => {
  return (
    <Layout>
      <Header title="${newPluginName.charAt(0).toUpperCase() + newPluginName.slice(1)}" />
      <Card title="Overview" borderColor="cyan">
        <Box flexDirection="column" paddingY={1}>
          <Text>Welcome to your new custom Swiss plugin!</Text>
          <Text color="gray">Modify this file at: .swiss/plugins/${newPluginName}.tsx</Text>
          {args.length > 0 && (
            <Text marginTop={1}>
              Arguments: <Text color="yellow">{args.join(', ')}</Text>
            </Text>
          )}
        </Box>
      </Card>
    </Layout>
  );
};

export default ${newPluginName.charAt(0).toUpperCase() + newPluginName.slice(1)}Plugin;
`;

      fs.writeFileSync(newPluginPath, template);
      console.log(`\nSuccessfully created plugin: ${newPluginName}`);
      console.log(`Path: ${newPluginPath}`);
      console.log(`Run it with: npm run dev ${newPluginName}\n`);
      return;
    }

    if (!pluginName) {
      const plugins = await loader.listPlugins();
      render(
        <Layout>
          <Header title="Menu" />
          <Text>Available plugins:</Text>
          {plugins.length === 0 ? (
            <Text color="gray">No plugins found in src/plugins/</Text>
          ) : (
            plugins.map(p => (
              <Text key={p}>  • {p}</Text>
            ))
          )}
          <Box marginTop={1}>
            <Text color="gray">Usage: swiss [plugin] [args...]</Text>
            <Text color="gray">Generate: swiss generate [name]</Text>
          </Box>
        </Layout>
      );
      return;
    }

    const plugin = await loader.loadPlugin(pluginName);
    
    if (!plugin || !plugin.default) {
      console.error(`Plugin "${pluginName}" not found or has no default export.`);
      process.exit(1);
    }

    const config = configManager.get(pluginName);

    const App = () => {
      const { exit } = useApp();
      const [isQuitSuppressed, setIsQuitSuppressed] = React.useState(false);

      useInput((input) => {
        if (input === 'q' && !isQuitSuppressed) {
          exit();
        }
      });

      return React.createElement(plugin.default, { 
        args: pluginArgs || [], 
        options,
        config,
        suppressQuit: setIsQuitSuppressed
      });
    };

    render(<App />);
  });

program.parseAsync(process.argv);
