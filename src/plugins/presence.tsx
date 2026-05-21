import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import fetch from 'node-fetch';
import { execa } from 'execa';
import { Header, Layout, Card, ScrollableList, Footer, StatusBadge, TextInputField, useTerminalSize } from '../components/UI.js';
import { PluginProps } from '../core/types.js';

export const name = 'Presence';
export const description = 'Developer status presence sync monitor';
export const configFields = [
  { key: 'slackWebhook', label: 'Slack Webhook URL', description: 'Webhook URL for automated Slack status updates' },
  { key: 'teamsWebhook', label: 'Teams Webhook URL', description: 'Webhook URL for automated MS Teams status updates' },
  { key: 'presenceHook', label: 'Presence Shell Hook', description: 'Path to executable shell hook script triggered on status change' }
];

interface StatusPreset {
  id: string;
  status: 'available' | 'busy' | 'dnd';
  message: string;
  label: string;
}

type Mode = 'VIEW' | 'CUSTOM_MSG_INPUT' | 'CUSTOM_TYPE_SELECT';

const PresencePlugin: React.FC<PluginProps> = ({ config }) => {
  const size = useTerminalSize();
  const maxVisiblePresets = Math.max(4, size.rows - 10);
  const maxVisibleLogs = Math.max(2, size.rows - 14);
  const [currentStatus, setCurrentStatus] = useState<'available' | 'busy' | 'dnd'>('available');
  const [statusMessage, setStatusMessage] = useState('Working on Swiss TUI');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('VIEW');
  const [customMsg, setCustomMsg] = useState('');
  const [customType, setCustomType] = useState<'available' | 'busy' | 'dnd'>('available');

  const [logs, setLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] Presence initialized: available`
  ]);

  const [presets, setPresets] = useState<StatusPreset[]>([
    { id: '1', status: 'available', message: 'Coding Deeply', label: 'Focused Coding' },
    { id: '2', status: 'busy', message: 'In a meeting / pairing', label: 'In Meeting' },
    { id: '3', status: 'dnd', message: 'Debugging heavy core leaks', label: 'Deep Work (DND)' },
    { id: '4', status: 'available', message: 'Be Right Back!', label: 'Short Break' },
  ]);

  const syncStatus = async (status: 'available' | 'busy' | 'dnd', message: string) => {
    setCurrentStatus(status);
    setStatusMessage(message);
    const timeStr = new Date().toLocaleTimeString();
    setLogs(prev => [`[${timeStr}] Syncing: ${status.toUpperCase()} - "${message}"`, ...prev]);

    // 1. Webhook Integrations
    const slackUrl = config.slackWebhook;
    const teamsUrl = config.teamsWebhook;

    try {
      if (slackUrl) {
        const res = await fetch(slackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `Presence updated: *${status.toUpperCase()}* - _"${message}"_`
          })
        });
        if (res.ok) {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] Slack sync: OK`, ...prev]);
        } else {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] Slack sync: Failed (${res.status})`, ...prev]);
        }
      }
      
      if (teamsUrl) {
        const res = await fetch(teamsUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `Presence updated: **${status.toUpperCase()}** - *"${message}"*`
          })
        });
        if (res.ok) {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] Teams sync: OK`, ...prev]);
        } else {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] Teams sync: Failed (${res.status})`, ...prev]);
        }
      }
    } catch (err: any) {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] Webhook Error: ${err.message}`, ...prev]);
    }

    // 2. Custom Shell Hook Integration
    const presenceHook = config.presenceHook;
    if (presenceHook) {
      try {
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] Triggering shell hook script...`, ...prev]);
        const { stdout } = await execa(presenceHook, [status, message]);
        if (stdout.trim()) {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] Hook stdout: ${stdout.trim().slice(0, 45)}`, ...prev]);
        }
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] Shell Hook: OK`, ...prev]);
      } catch (err: any) {
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] Shell Hook Error: ${err.message}`, ...prev]);
      }
    }
  };

  useInput((input, key) => {
    if (mode === 'VIEW') {
      if (key.downArrow && presets.length > 0) {
        setSelectedIndex((prev) => Math.min(prev + 1, presets.length - 1));
      }
      if (key.upArrow && presets.length > 0) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
      if (key.return) {
        const preset = presets[selectedIndex];
        if (preset) {
          syncStatus(preset.status, preset.message);
        }
      }
      if (input === 'c') {
        setMode('CUSTOM_TYPE_SELECT');
      }
      if (input === 's') {
        // Manual triggers
        syncStatus(currentStatus, statusMessage);
      }
    } else if (mode === 'CUSTOM_TYPE_SELECT') {
      if (input === '1') {
        setCustomType('available');
        setMode('CUSTOM_MSG_INPUT');
      }
      if (input === '2') {
        setCustomType('busy');
        setMode('CUSTOM_MSG_INPUT');
      }
      if (input === '3') {
        setCustomType('dnd');
        setMode('CUSTOM_MSG_INPUT');
      }
      if (key.escape) {
        setMode('VIEW');
      }
    } else if (mode === 'CUSTOM_MSG_INPUT') {
      if (key.escape) {
        setMode('VIEW');
      }
    }
  });

  const handleCustomMsgSubmit = () => {
    if (!customMsg) return;
    const newPreset: StatusPreset = {
      id: String(presets.length + 1),
      status: customType,
      message: customMsg,
      label: customMsg.length > 15 ? customMsg.slice(0, 15) + '...' : customMsg
    };
    setPresets(prev => [...prev, newPreset]);
    setSelectedIndex(presets.length); // Select new preset
    syncStatus(customType, customMsg);
    setCustomMsg('');
    setMode('VIEW');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'green';
      case 'busy': return 'red';
      case 'dnd': return 'yellow';
      default: return 'white';
    }
  };

  const slackUrl = config.slackWebhook;
  const teamsUrl = config.teamsWebhook;
  const presenceHook = config.presenceHook;

  return (
    <Layout>
      <Header title="Presence Synchronizer" />

      {mode === 'VIEW' && (
        <>
          <Box flexDirection="row" flexGrow={1}>
            {/* Presets Card */}
            <Box width="45%" marginRight={1}>
              <Card title="Status Presets" borderColor="cyan" width="100%" flexGrow={1}>
                <ScrollableList 
                  items={presets}
                  selectedIndex={selectedIndex}
                  renderItem={(item, isSelected) => (
                    <Box key={item.id} flexDirection="row" justifyContent="space-between">
                      <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                        {isSelected ? '▶ ' : '  '}{item.label}
                      </Text>
                      <StatusBadge status={item.status} />
                    </Box>
                  )}
                  maxVisible={maxVisiblePresets}
                />
              </Card>
            </Box>

            {/* Status Details / Logs Pane */}
            <Box width="55%">
              <Card title="Active Presence & Logs" borderColor={getStatusColor(currentStatus)} width="100%" flexGrow={1}>
                <Box borderStyle="single" borderColor={getStatusColor(currentStatus)} paddingX={1} flexDirection="column" marginBottom={1}>
                  <Text>Current Status: <StatusBadge status={currentStatus} /></Text>
                  <Text color="gray">Message: <Text color="white" bold>"{statusMessage}"</Text></Text>
                </Box>
                
                <Box flexDirection="column" flexGrow={1}>
                  <Text bold color="gray" underline>Sync logs:</Text>
                  <ScrollableList 
                    items={logs}
                    selectedIndex={0}
                    renderItem={(log) => (
                      <Text key={Math.random()} color="gray" wrap="truncate">{log}</Text>
                    )}
                    maxVisible={maxVisibleLogs}
                  />
                </Box>
              </Card>
            </Box>
          </Box>

          <Box marginTop={1} flexDirection="row">
            <Box marginRight={3}>
              <Text color="gray">Slack: <Text color={slackUrl ? 'green' : 'gray'}>{slackUrl ? '✓ Active' : '○ Off'}</Text></Text>
            </Box>
            <Box marginRight={3}>
              <Text color="gray">Teams: <Text color={teamsUrl ? 'green' : 'gray'}>{teamsUrl ? '✓ Active' : '○ Off'}</Text></Text>
            </Box>
            <Box>
              <Text color="gray">Shell Hook: <Text color={presenceHook ? 'green' : 'gray'}>{presenceHook ? '✓ Active' : '○ Off'}</Text></Text>
            </Box>
          </Box>

          <Footer 
            keys={[
              { key: '↑/↓', desc: 'Navigate presets' },
              { key: 'Enter', desc: 'Activate selected' },
              { key: 'c', desc: 'Custom presence' },
              { key: 's', desc: 'Force sync' },
              { key: 'q', desc: 'Quit presence' }
            ]}
          />
        </>
      )}

      {mode === 'CUSTOM_TYPE_SELECT' && (
        <Box flexDirection="column" width="100%">
          <Card title="Select Status Type for Custom Presence" borderColor="cyan">
            <Box paddingY={1} flexDirection="column">
              <Text color="green" bold>[1] Available</Text>
              <Box marginTop={1}>
                <Text color="red" bold>[2] Busy</Text>
              </Box>
              <Box marginTop={1}>
                <Text color="yellow" bold>[3] Do Not Disturb (DND)</Text>
              </Box>
            </Box>
          </Card>
          <Footer keys={[{ key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}

      {mode === 'CUSTOM_MSG_INPUT' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label={`Enter Status Message (Type and Press Enter)`} 
            value={customMsg} 
            onChange={setCustomMsg} 
            onSubmit={handleCustomMsgSubmit}
            placeholder="e.g. Coding heavy algorithms..."
          />
          <Footer keys={[{ key: 'Enter', desc: 'Apply & Sync' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}
    </Layout>
  );
};

export default PresencePlugin;
