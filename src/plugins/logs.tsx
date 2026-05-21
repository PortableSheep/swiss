import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useInput } from 'ink';
import { execa } from 'execa';
import fs from 'fs';
import { Header, Layout, Card, ScrollableList, Footer, TextInputField, StatusBadge, useTerminalSize, useMouse } from '../components/UI.js';
import { PluginProps } from '../core/types.js';

export const name = 'Logs';
export const description = 'Multi-source log viewer and log monitor';
export const configFields = [
  { key: 'defaultService', label: 'Default Service Name', description: 'Default service name for Logs Plugin' }
];

interface LogLine {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'RAW';
  message: string;
}

type SourceType = 'MOCK' | 'FILE' | 'COMMAND';
type Mode = 'VIEW' | 'FILTER_INPUT' | 'FILE_INPUT' | 'COMMAND_INPUT';
type FocusArea = 'CONTROLS' | 'LOGS';

const LogsPlugin: React.FC<PluginProps> = ({ config }) => {
  const size = useTerminalSize();
  const maxVisibleLogs = Math.max(4, size.rows - 10);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [sourceType, setSourceType] = useState<SourceType>('MOCK');
  const [mode, setMode] = useState<Mode>('VIEW');
  const [focus, setFocus] = useState<FocusArea>('CONTROLS');
  const [logSelectedIndex, setLogSelectedIndex] = useState(0);
  const [dumpStatus, setDumpStatus] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');

  useMouse((event) => {
    if (mode !== 'VIEW') return;

    if (event.type === 'left_click') {
      const pctY = event.y / size.rows;
      if (pctY < 0.8) {
        setFocus('LOGS');
      } else {
        setFocus('CONTROLS');
      }
    } else if (event.type === 'scroll_up') {
      if (focus === 'LOGS') {
        setLogSelectedIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (event.type === 'scroll_down') {
      if (focus === 'LOGS') {
        setLogSelectedIndex((prev) => Math.min(filteredLogs.length - 1, prev + 1));
      }
    }
  });
  
  // Inputs
  const [filePath, setFilePath] = useState('./app.log');
  const [shellCommand, setShellCommand] = useState('ping -c 10 google.com');
  const [activeFilePath, setActiveFilePath] = useState('');
  const [activeCommand, setActiveCommand] = useState('');

  const logsRef = useRef<LogLine[]>([]);
  const subprocessRef = useRef<any>(null);

  // Helper to parse severity level from text
  const parseLogLevel = (msg: string): LogLine['level'] => {
    const uppercase = msg.toUpperCase();
    if (uppercase.includes('ERROR') || uppercase.includes('ERR') || uppercase.includes('500') || uppercase.includes('FATAL')) {
      return 'ERROR';
    }
    if (uppercase.includes('WARN') || uppercase.includes('WARNING') || uppercase.includes('400')) {
      return 'WARN';
    }
    if (uppercase.includes('INFO') || uppercase.includes('SUCCESS') || uppercase.includes('GET') || uppercase.includes('POST')) {
      return 'INFO';
    }
    return 'RAW';
  };

  const addLog = (message: string, level?: LogLine['level']) => {
    if (isPaused) return;
    const resolvedLevel = level || parseLogLevel(message);
    const newLog: LogLine = {
      timestamp: new Date().toLocaleTimeString(),
      level: resolvedLevel,
      message,
    };
    logsRef.current = [...logsRef.current, newLog].slice(-100); // Keep last 100 logs for better scrollback buffer
    setLogs(logsRef.current);
  };

  // Lifecycle for Log Streams
  useEffect(() => {
    // Clean up any existing background stream
    if (subprocessRef.current) {
      subprocessRef.current.kill();
      subprocessRef.current = null;
    }

    if (sourceType === 'MOCK') {
      const interval = setInterval(() => {
        const rand = Math.random();
        if (rand > 0.6) {
          if (rand > 0.94) addLog(`[Database] Spike detected - pool connections near capacity (92%)`, 'WARN');
          else if (rand > 0.97) addLog(`[Auth] Failed to process JWT signature verification: 500 Server Error`, 'ERROR');
          else if (rand > 0.8) addLog(`[Router] GET /api/v1/users/portablesheep/settings - 200 OK`);
          else addLog(`[Sync] Background presence heartbeat successfully published`);
        }
      }, 1500);
      return () => clearInterval(interval);
    } 
    
    if (sourceType === 'FILE' && activeFilePath) {
      addLog(`[System] Initializing tail stream on file: ${activeFilePath}`, 'RAW');
      try {
        // Create file if it doesn't exist so tail doesn't crash
        if (!fs.existsSync(activeFilePath)) {
          fs.writeFileSync(activeFilePath, `--- Swiss Log Session Initialized: ${new Date().toISOString()} ---\n`);
        }

        const proc = execa('tail', ['-f', '-n', '20', activeFilePath]);
        subprocessRef.current = proc;

        proc.stdout?.on('data', (data) => {
          const lines = data.toString().split('\n').filter(Boolean);
          lines.forEach((line: string) => addLog(line));
        });

        proc.stderr?.on('data', (data) => {
          addLog(`[tail error] ${data.toString()}`, 'ERROR');
        });

        proc.on('close', () => {
          addLog(`[System] File tailing stream closed`, 'RAW');
        });
      } catch (err: any) {
        addLog(`[System] Failed to tail file: ${err.message}`, 'ERROR');
      }
    }

    if (sourceType === 'COMMAND' && activeCommand) {
      addLog(`[System] Spawning subprocess: ${activeCommand}`, 'RAW');
      try {
        const words = activeCommand.split(' ');
        const proc = execa(words[0], words.slice(1));
        subprocessRef.current = proc;

        proc.stdout?.on('data', (data) => {
          const lines = data.toString().split('\n').filter(Boolean);
          lines.forEach((line: string) => addLog(line));
        });

        proc.stderr?.on('data', (data) => {
          const lines = data.toString().split('\n').filter(Boolean);
          lines.forEach((line: string) => addLog(line, 'WARN'));
        });

        proc.on('close', (code) => {
          addLog(`[System] Process terminated with exit code ${code}`, 'RAW');
        });
      } catch (err: any) {
        addLog(`[System] Execution failed: ${err.message}`, 'ERROR');
      }
    }

    return () => {
      if (subprocessRef.current) {
        subprocessRef.current.kill();
      }
    };
  }, [sourceType, activeFilePath, activeCommand]);

  // Filter logs locally
  const filteredLogs = logs.filter((log) => 
    !filterQuery || log.message.toLowerCase().includes(filterQuery.toLowerCase())
  );

  // Auto-dock log scroll index when new logs are added, but only if they were already at the bottom
  const prevLengthRef = useRef(filteredLogs.length);
  useEffect(() => {
    if (logSelectedIndex >= prevLengthRef.current - 1 || logSelectedIndex < 0) {
      setLogSelectedIndex(Math.max(0, filteredLogs.length - 1));
    }
    prevLengthRef.current = filteredLogs.length;
  }, [filteredLogs.length, logSelectedIndex]);

  useInput((input, key) => {
    if (mode === 'VIEW') {
      if (key.tab) {
        setFocus((prev) => (prev === 'CONTROLS' ? 'LOGS' : 'CONTROLS'));
        return;
      }

      if (focus === 'LOGS') {
        if (key.upArrow) {
          setLogSelectedIndex((prev) => Math.max(0, prev - 1));
          return;
        }
        if (key.downArrow) {
          setLogSelectedIndex((prev) => Math.min(filteredLogs.length - 1, prev + 1));
          return;
        }
      }

      if (input === 'p') {
        setIsPaused(!isPaused);
      }
      if (input === 'c') {
        logsRef.current = [];
        setLogs([]);
        setLogSelectedIndex(0);
      }
      if (input === 'd') {
        try {
          const logDump = logsRef.current.map(log => `[${log.timestamp}] [${log.level.padEnd(5)}] ${log.message}`).join('\n');
          fs.writeFileSync('./logs-dump.txt', logDump);
          setDumpStatus('Logs written successfully to ./logs-dump.txt');
          const timer = setTimeout(() => setDumpStatus(null), 3000);
          return () => clearTimeout(timer);
        } catch (err: any) {
          setDumpStatus(`Error: ${err.message}`);
          const timer = setTimeout(() => setDumpStatus(null), 5000);
          return () => clearTimeout(timer);
        }
      }
      if (input === '/') {
        setMode('FILTER_INPUT');
      }
      if (input === 's') {
        // Toggle sources
        setSourceType((prev) => {
          if (prev === 'MOCK') return 'FILE';
          if (prev === 'FILE') return 'COMMAND';
          return 'MOCK';
        });
      }
      if (input === 'f') {
        setMode('FILE_INPUT');
      }
      if (input === 'x') {
        setMode('COMMAND_INPUT');
      }
    } else {
      if (key.escape) {
        setMode('VIEW');
      }
    }
  });

  const handleFilterSubmit = () => {
    setMode('VIEW');
  };

  const handleFileSubmit = () => {
    setActiveFilePath(filePath);
    setSourceType('FILE');
    setMode('VIEW');
  };

  const handleCommandSubmit = () => {
    setActiveCommand(shellCommand);
    setSourceType('COMMAND');
    setMode('VIEW');
  };

  const getLevelColor = (level: LogLine['level']) => {
    if (level === 'ERROR') return 'red';
    if (level === 'WARN') return 'yellow';
    if (level === 'RAW') return 'cyan';
    return 'green';
  };

  const isLogsFocused = focus === 'LOGS';

  const footerKeys = isLogsFocused 
    ? [
        { key: 'Tab', desc: 'Focus Controls' },
        { key: '↑/↓', desc: 'Scroll Buffer' },
        { key: 'd', desc: 'Dump logs to file' },
        { key: 'c', desc: 'Clear buffer' },
        { key: 'q', desc: 'Quit Logs' }
      ]
    : [
        { key: 'Tab', desc: 'Focus Logs Card' },
        { key: 'p', desc: 'Pause/Resume' },
        { key: 'c', desc: 'Clear' },
        { key: '/', desc: 'Filter live logs' },
        { key: 's', desc: 'Switch Source' },
        { key: 'f', desc: 'Set File Path' },
        { key: 'x', desc: 'Set Command' },
        { key: 'd', desc: 'Dump logs to file' },
        { key: 'q', desc: 'Quit Logs' }
      ];

  return (
    <Layout>
      <Header 
        title={`Logs Tailer [Source: ${sourceType}]${isPaused ? ' (PAUSED)' : ''}`} 
      />

      {mode === 'VIEW' && (
        <>
          <Card 
            title={`Active Log Stream ${filterQuery ? `(Filtered: "${filterQuery}")` : ''}${isLogsFocused ? ' [FOCUSED - Scroll with ↑/↓]' : ''}`} 
            borderColor={isLogsFocused ? 'cyan' : isPaused ? 'yellow' : 'gray'} 
            flexGrow={1}
          >
            {filteredLogs.length === 0 ? (
              <Text color="gray">Waiting for log stream data...</Text>
            ) : (
              <ScrollableList 
                items={filteredLogs}
                selectedIndex={logSelectedIndex}
                renderItem={(log, isSelected) => (
                  <Text key={`${log.timestamp}-${log.message}`} wrap="truncate">
                    <Text color={isSelected ? 'blue' : 'gray'}>[{log.timestamp}] </Text>
                    <Text color={getLevelColor(log.level)} bold>{log.level.padEnd(5)} </Text>
                    <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>{log.message}</Text>
                  </Text>
                )}
                maxVisible={maxVisibleLogs}
              />
            )}
          </Card>

          <Box marginTop={1} flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row">
              <Box marginRight={4}>
                <Text color="gray">Active Source: <Text color="white" bold>{sourceType}</Text></Text>
              </Box>
              <Box marginRight={4}>
                <Text color="gray">Filter: <Text color={filterQuery ? 'cyan' : 'gray'}>{filterQuery || '<none>'}</Text></Text>
              </Box>
              <Box marginRight={4}>
                <Text color="gray">Status: <Text color={isPaused ? 'yellow' : 'green'} bold>{isPaused ? 'Frozen' : 'Streaming'}</Text></Text>
              </Box>
            </Box>
            {dumpStatus && (
              <Box>
                <StatusBadge status={dumpStatus.includes('Error') ? 'Error' : 'Clean'} />
                <Text color="white"> {dumpStatus.includes('Error') ? 'Dump Failed' : 'Dump Saved'}</Text>
              </Box>
            )}
          </Box>

          <Footer keys={footerKeys} />
        </>
      )}

      {mode === 'FILTER_INPUT' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Filter Log Message (Type and Press Enter)" 
            value={filterQuery} 
            onChange={setFilterQuery} 
            onSubmit={handleFilterSubmit}
            placeholder="Type regex or substring, e.g. JWT..."
          />
          <Footer keys={[{ key: 'Enter', desc: 'Apply Filter' }, { key: 'Esc', desc: 'Clear Filter / Close' }]} />
        </Box>
      )}

      {mode === 'FILE_INPUT' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Tailing Local File Path" 
            value={filePath} 
            onChange={setFilePath} 
            onSubmit={handleFileSubmit}
            placeholder="e.g. ./app.log or /var/log/system.log"
          />
          <Footer keys={[{ key: 'Enter', desc: 'Tail File' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}

      {mode === 'COMMAND_INPUT' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Tailing Shell Command Output" 
            value={shellCommand} 
            onChange={setShellCommand} 
            onSubmit={handleCommandSubmit}
            placeholder="e.g. ping google.com or docker logs -f myapp"
          />
          <Footer keys={[{ key: 'Enter', desc: 'Execute Command' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}
    </Layout>
  );
};

export default LogsPlugin;
