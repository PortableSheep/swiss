import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useInput } from 'ink';
import os from 'os';
import { Header, Layout, Card, Footer, StatusBadge, useTerminalSize } from '../components/UI.js';
import { PluginProps } from '../core/types.js';

export const name = 'SysInfo';
export const description = 'A lightweight, real-time system resource and hardware monitor';

interface CPUTimes {
  idle: number;
  total: number;
}

const getCPUTimes = (): CPUTimes => {
  const cpus = os.cpus();
  let user = 0;
  let nice = 0;
  let sys = 0;
  let idle = 0;
  let irq = 0;

  for (const cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }

  const total = user + nice + sys + idle + irq;
  return { idle, total };
};

const SysInfoPlugin: React.FC<PluginProps> = () => {
  const size = useTerminalSize();
  const maxSparkHistory = Math.max(10, Math.min(60, size.columns - 15));

  const [cpuUsage, setCpuUsage] = useState(0);
  const [ramTotal, setRamTotal] = useState(os.totalmem());
  const [ramFree, setRamFree] = useState(os.freemem());
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);
  const [historyMode, setHistoryMode] = useState<'CPU' | 'RAM'>('CPU');
  const [uptime, setUptime] = useState(os.uptime());
  const [loadAvg, setLoadAvg] = useState<number[]>([0, 0, 0]);
  const [showHeader, setShowHeader] = useState(true);

  // Keep track of the last CPU times to compute CPU delta usage
  const lastCpuTimes = useRef<CPUTimes>(getCPUTimes());

  const updateStats = () => {
    // 1. Calculate CPU Usage Percentage
    const currentTimes = getCPUTimes();
    const prevTimes = lastCpuTimes.current;

    const idleDiff = currentTimes.idle - prevTimes.idle;
    const totalDiff = currentTimes.total - prevTimes.total;
    const cpuPct = totalDiff === 0 ? 0 : Math.max(0, Math.min(100, 100 - (100 * idleDiff) / totalDiff));
    
    lastCpuTimes.current = currentTimes;
    setCpuUsage(cpuPct);

    // 2. Fetch Memory Statistics
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    setRamTotal(totalMem);
    setRamFree(freeMem);

    // 3. Update Rolling History
    setCpuHistory((prev) => {
      const updated = [...prev, cpuPct];
      if (updated.length > maxSparkHistory) updated.shift();
      return updated;
    });

    const ramUsedPct = ((totalMem - freeMem) / totalMem) * 100;
    setRamHistory((prev) => {
      const updated = [...prev, ramUsedPct];
      if (updated.length > maxSparkHistory) updated.shift();
      return updated;
    });

    // 4. Update Uptime & Load Avg
    setUptime(os.uptime());
    try {
      setLoadAvg(os.loadavg());
    } catch {}
  };

  useEffect(() => {
    // Perform initial tick to populate first values
    updateStats();

    const interval = setInterval(() => {
      updateStats();
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [maxSparkHistory]);

  useInput((input, key) => {
    if (input === 'c') {
      setHistoryMode((prev) => (prev === 'CPU' ? 'RAM' : 'CPU'));
    }
    if (input === 'r') {
      updateStats();
    }
    if (input === 'h') {
      setShowHeader((prev) => !prev);
    }
  });

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2)} GB`;
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  };

  const renderProgressBar = (percent: number) => {
    const barWidth = Math.max(10, Math.min(30, size.columns - 35));
    const filledWidth = Math.round((percent / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;
    
    const filledPart = '█'.repeat(filledWidth);
    const emptyPart = '░'.repeat(emptyWidth);
    
    let color = 'green';
    if (percent >= 80) color = 'red';
    else if (percent >= 50) color = 'yellow';

    return (
      <Text>
        <Text color={color}>[{filledPart}</Text>
        <Text color="gray">{emptyPart}]</Text>
        <Text color={color} bold> {percent.toFixed(1)}%</Text>
      </Text>
    );
  };

  const getSparkChar = (val: number) => {
    const sparkChars = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    const idx = Math.min(sparkChars.length - 1, Math.floor((val / 100) * sparkChars.length));
    return sparkChars[idx];
  };

  const renderSparkline = (history: number[]) => {
    const padded = Array(Math.max(0, maxSparkHistory - history.length)).fill(0).concat(history);
    return (
      <Box flexDirection="row">
        {padded.map((val, idx) => {
          const char = getSparkChar(val);
          let color = 'green';
          if (val >= 80) color = 'red';
          else if (val >= 50) color = 'yellow';
          return <Text key={idx} color={color}>{char}</Text>;
        })}
      </Box>
    );
  };

  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model.trim() || 'Generic CPU';
  const cpuCores = cpus.length;

  const ramUsed = ramTotal - ramFree;
  const ramUsedPct = (ramUsed / ramTotal) * 100;

  const currentHistory = historyMode === 'CPU' ? cpuHistory : ramHistory;

  // Tier 1: Super Compact Mode (For extremely small Ghostty tiled panes)
  if (size.columns < 65 || size.rows < 15) {
    return (
      <Layout>
        {showHeader && <Header title="SysInfo [Compact]" />}
        <Card title={`Resource Status (${historyMode})`} borderColor="cyan" flexGrow={1}>
          <Box flexDirection="column" paddingY={1} paddingX={1} flexGrow={1} justifyContent="space-between">
            <Box flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between">
                <Text color="cyan" bold>CPU </Text>
                {renderProgressBar(cpuUsage)}
              </Box>
              <Box flexDirection="row" justifyContent="space-between" marginTop={1}>
                <Text color="green" bold>RAM </Text>
                {renderProgressBar(ramUsedPct)}
              </Box>
            </Box>
            <Box flexDirection="column" marginTop={1} alignItems="center">
              <Box marginBottom={1}>
                {renderSparkline(currentHistory)}
              </Box>
              <Text color="gray" dimColor>Press 'c' to toggle graph</Text>
            </Box>
          </Box>
        </Card>
        <Footer
          keys={[
            { key: 'c', desc: 'CPU/RAM' },
            { key: 'h', desc: 'Toggle Header' },
            { key: 'q', desc: 'Quit' }
          ]}
        />
      </Layout>
    );
  }

  // Tier 2: Stacked Mode (For medium-sized or narrow tiled regions)
  if (size.columns < 95 || size.rows < 22) {
    return (
      <Layout>
        {showHeader && <Header title="System Monitor [Tiled]" />}
        <Box flexDirection="column" flexGrow={1}>
          <Card title="Resource Gauges" borderColor="cyan" marginBottom={1}>
            <Box flexDirection="row" justifyContent="space-between" paddingY={1} paddingX={1}>
              <Box flexDirection="column" width="48%">
                <Text color="white" bold>CPU Load:</Text>
                {renderProgressBar(cpuUsage)}
              </Box>
              <Box flexDirection="column" width="48%">
                <Text color="white" bold>RAM Usage:</Text>
                {renderProgressBar(ramUsedPct)}
                <Text color="gray" dimColor>
                  {formatBytes(ramUsed)} / {formatBytes(ramTotal)}
                </Text>
              </Box>
            </Box>
          </Card>

          <Card title={`Timeline History (${historyMode})`} borderColor="yellow" flexGrow={1}>
            <Box flexDirection="column" paddingY={1} alignItems="center" justifyContent="center" flexGrow={1}>
              <Box marginBottom={1}>
                {renderSparkline(currentHistory)}
              </Box>
              <Text color="gray">Showing rolling system history</Text>
            </Box>
          </Card>
        </Box>
        <Footer
          keys={[
            { key: 'c', desc: 'Toggle CPU/RAM' },
            { key: 'h', desc: 'Toggle Header' },
            { key: 'r', desc: 'Refresh' },
            { key: 'q', desc: 'Quit' }
          ]}
        />
      </Layout>
    );
  }

  // Tier 3: Full Dashboard Mode (For standard rich displays)
  return (
    <Layout>
      {showHeader && <Header title="System Resource Monitor" />}

      {/* Top Half: Gauges & System Information */}
      <Box flexDirection="row" width="100%" marginBottom={1}>
        <Box width="50%" marginRight={1}>
          <Card title="Gauges" borderColor="cyan" width="100%">
            <Box flexDirection="column" paddingY={1}>
              <Box flexDirection="column" marginBottom={1}>
                <Text color="white" bold>CPU Utilization:</Text>
                {renderProgressBar(cpuUsage)}
              </Box>
              <Box flexDirection="column">
                <Text color="white" bold>Memory Usage (RAM):</Text>
                {renderProgressBar(ramUsedPct)}
                <Text color="gray">
                  {formatBytes(ramUsed)} / {formatBytes(ramTotal)} used
                </Text>
              </Box>
            </Box>
          </Card>
        </Box>

        <Box width="50%">
          <Card title="Hardware Info" borderColor="green" width="100%">
            <Box flexDirection="column" paddingY={1}>
              <Text color="cyan" bold>Host: <Text color="white">{os.hostname()}</Text></Text>
              <Text color="cyan" bold>OS: <Text color="white">{os.type()} ({os.arch()})</Text></Text>
              <Text color="cyan" bold>CPU Model: <Text color="white" wrap="truncate">{cpuModel} ({cpuCores} cores)</Text></Text>
              <Text color="cyan" bold>System Uptime: <Text color="white">{formatUptime(uptime)}</Text></Text>
              <Text color="cyan" bold>Load Avg: <Text color="white">{loadAvg.map(l => l.toFixed(2)).join(', ')}</Text></Text>
            </Box>
          </Card>
        </Box>
      </Box>

      {/* Bottom Half: Sparkline Timeline History */}
      <Card title={`Performance Timeline History (${historyMode})`} borderColor="yellow" flexGrow={1}>
        <Box flexDirection="column" paddingY={1} alignItems="center" justifyContent="center" flexGrow={1}>
          <Box marginBottom={1}>
            {renderSparkline(currentHistory)}
          </Box>
          <Box>
            <Text color="gray">Showing past {currentHistory.length} seconds of active tracking.</Text>
          </Box>
        </Box>
      </Card>

      <Footer
        keys={[
          { key: 'c', desc: 'Toggle CPU/RAM history' },
          { key: 'h', desc: 'Toggle Header' },
          { key: 'r', desc: 'Manual Tick Update' },
          { key: 'q', desc: 'Quit' }
        ]}
      />
    </Layout>
  );
};

export default SysInfoPlugin;
