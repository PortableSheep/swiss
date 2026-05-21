import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import { Header, Layout, Card, ScrollableList, Footer, TextInputField, useTerminalSize } from '../components/UI.js';
import { PluginProps } from '../core/types.js';
import { ConfigManager } from '../core/ConfigManager.js';
import { PluginLoader } from '../core/PluginLoader.js';

export const name = 'Config';
export const description = 'Interactive configuration workbench for Swiss';

const configManager = new ConfigManager();
const loader = new PluginLoader();

interface ConfigField {
  plugin: string;
  key: string;
  label: string;
  description: string;
}

const ConfigPlugin: React.FC<PluginProps> = ({ suppressQuit }) => {
  const size = useTerminalSize();
  const [fields, setFields] = useState<ConfigField[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Handle global quit suppression when editing
  useEffect(() => {
    if (suppressQuit) {
      suppressQuit(isEditing);
    }
    return () => {
      if (suppressQuit) suppressQuit(false);
    };
  }, [isEditing, suppressQuit]);

  useEffect(() => {
    const loadFields = async () => {
      try {
        const pluginNames = await loader.listPlugins();
        const loadedFields: ConfigField[] = [];
        
        for (const pName of pluginNames) {
          if (pName === 'config') continue; // Avoid self-reference configuration
          
          const plugin = await loader.loadPlugin(pName);
          if (plugin && plugin.configFields && plugin.configFields.length > 0) {
            const displayName = plugin.name || (pName.charAt(0).toUpperCase() + pName.slice(1));
            for (const field of plugin.configFields) {
              loadedFields.push({
                plugin: pName,
                key: field.key,
                label: `${displayName}: ${field.label}`,
                description: field.description
              });
            }
          }
        }
        setFields(loadedFields);
      } catch (error) {
        console.error('Error listing/loading plugin configurations:', error);
      } finally {
        setLoading(false);
      }
    };
    loadFields();
  }, []);

  const maxVisibleFields = Math.max(4, size.rows - 10);

  // Load current values dynamically from ConfigManager
  const getFieldValue = (field: ConfigField) => {
    const section = configManager.get(field.plugin);
    return section[field.key] || '';
  };

  useInput((input, key) => {
    if (loading || fields.length === 0) return;

    if (!isEditing) {
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, fields.length - 1));
        setSuccessMsg('');
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        setSuccessMsg('');
      }
      if (key.return) {
        setEditValue(getFieldValue(fields[selectedIndex]));
        setIsEditing(true);
        setSuccessMsg('');
      }
    } else {
      if (key.escape) {
        setIsEditing(false);
      }
    }
  });

  const handleSave = () => {
    const field = fields[selectedIndex];
    configManager.set(field.plugin, { [field.key]: editValue });
    setIsEditing(false);
    setSuccessMsg(`Saved ${field.label} successfully!`);
  };

  if (loading) {
    return (
      <Layout>
        <Header title="Config Manager" />
        <Box flexGrow={1} justifyContent="center" alignItems="center">
          <Text color="cyan">Scanning plugins and loading configurations...</Text>
        </Box>
        <Footer keys={[{ key: 'q', desc: 'Quit config' }]} />
      </Layout>
    );
  }

  if (fields.length === 0) {
    return (
      <Layout>
        <Header title="Config Manager" />
        <Box flexGrow={1} justifyContent="center" alignItems="center" flexDirection="column">
          <Text color="yellow">No configuration fields defined by any active plugins.</Text>
          <Box marginTop={1}>
            <Text color="gray">Add a 'configFields' export to a plugin to configure it here.</Text>
          </Box>
        </Box>
        <Footer keys={[{ key: 'q', desc: 'Quit config' }]} />
      </Layout>
    );
  }

  const activeField = fields[selectedIndex];

  return (
    <Layout>
      <Header title="Config Manager" />
      
      <Box flexDirection="row" flexGrow={1}>
        <Box width="45%">
          <Card title="Settings List" borderColor="cyan" width="100%" flexGrow={1}>
            <ScrollableList 
              items={fields.map((f, index) => {
                const val = getFieldValue(f);
                const maskedVal = val ? (val.length > 20 ? val.slice(0, 17) + '...' : val) : '<empty>';
                return {
                  label: `${index === selectedIndex ? '▶' : ' '} ${f.label}: ${maskedVal}`,
                  value: f.key
                };
              })}
              selectedIndex={selectedIndex}
              maxVisible={maxVisibleFields}
            />
          </Card>
        </Box>

        <Box width="55%" marginLeft={1}>
          {isEditing ? (
            <Box flexDirection="column" width="100%">
              <TextInputField 
                label={`Editing: ${activeField.label}`} 
                value={editValue} 
                onChange={setEditValue} 
                onSubmit={handleSave}
                placeholder="Enter value..."
              />
              <Box marginTop={1} paddingX={1}>
                <Text color="gray">{activeField.description}</Text>
              </Box>
            </Box>
          ) : (
            <Card title="Setting Detail" borderColor="gray" width="100%" flexGrow={1}>
              <Box flexDirection="column" paddingY={1}>
                <Text bold color="cyan">{activeField.label}</Text>
                <Box marginTop={1}>
                  <Text color="gray">{activeField.description}</Text>
                </Box>
                
                <Box marginTop={2} borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="column">
                  <Text bold color="white">Current Value:</Text>
                  <Box marginTop={1}>
                    <Text color="yellow">
                      {getFieldValue(activeField) || '<Not Configured>'}
                    </Text>
                  </Box>
                </Box>

                {successMsg && (
                  <Box marginTop={1}>
                    <Text color="green" bold>
                      ✓ {successMsg}
                    </Text>
                  </Box>
                )}
              </Box>
            </Card>
          )}
        </Box>
      </Box>

      <Footer 
        keys={
          isEditing 
            ? [
                { key: 'Enter', desc: 'Save changes' },
                { key: 'Esc', desc: 'Cancel editing' }
              ]
            : [
                { key: '↑/↓', desc: 'Navigate fields' },
                { key: 'Enter', desc: 'Edit highlighted' },
                { key: 'q', desc: 'Quit config' }
              ]
        }
      />
    </Layout>
  );
};

export default ConfigPlugin;
