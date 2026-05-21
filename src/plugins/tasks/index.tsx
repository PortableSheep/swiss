import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import fetch from 'node-fetch';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Header, Layout, Card, ScrollableList, Footer, StatusBadge, TextInputField, useTerminalSize, useMouse } from '../../components/UI.js';
import { PluginProps } from '../../core/types.js';
import { ConfigManager } from '../../core/ConfigManager.js';
import { parseDescription, TaskItem } from './taskParser.js';

export const name = 'Tasks';
export const description = 'Intelligent checklist workbench for active Jira stories';

interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  description: string;
}

type Mode = 'VIEW' | 'ADD_TASK';
type FocusedPane = 'STORIES' | 'CHECKLIST';

// Local disk persistence path: ~/.swiss_jira_tasks.json
const getCachePath = () => {
  return path.join(os.homedir(), '.swiss_jira_tasks.json');
};

const loadChecklistsFromDisk = (): Record<string, TaskItem[]> => {
  const filePath = getCachePath();
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }
  return {};
};

const saveChecklistsToDisk = (checklists: Record<string, TaskItem[]>) => {
  const filePath = getCachePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(checklists, null, 2), 'utf-8');
  } catch {
    // Fail silently in CLI environment
  }
};

const TasksPlugin: React.FC<PluginProps> = ({ suppressQuit }) => {
  const size = useTerminalSize();
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [activeIssue, setActiveIssue] = useState<JiraIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  // Pane and focus state
  const [focusedPane, setFocusedPane] = useState<FocusedPane>('STORIES');
  const [mode, setMode] = useState<Mode>('VIEW');

  // Indexes for scrolling lists
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [checklistSelectedIndex, setChecklistSelectedIndex] = useState(0);

  // Persistence checklists state
  const [allChecklists, setAllChecklists] = useState<Record<string, TaskItem[]>>({});
  const [newTaskText, setNewTaskText] = useState('');

  // Handle global quit suppression when adding a task
  useEffect(() => {
    if (suppressQuit) {
      suppressQuit(mode === 'ADD_TASK');
    }
    return () => {
      if (suppressQuit) suppressQuit(false);
    };
  }, [mode, suppressQuit]);

  // Dynamically load config from ConfigManager
  const loadConfig = () => {
    try {
      const configManager = new ConfigManager();
      return configManager.get('jira');
    } catch {
      return {};
    }
  };

  // Helper to sync issues list with checklists (runs on load/refresh once)
  const syncIssuesWithChecklists = (list: JiraIssue[], loadedChecklists: Record<string, TaskItem[]>) => {
    let updatedChecklists = { ...loadedChecklists };
    let hasChanges = false;

    for (const issue of list) {
      if (!updatedChecklists[issue.key]) {
        const parsed = parseDescription(issue.description, issue.summary);
        const taskItems: TaskItem[] = parsed.map((t, idx) => ({
          id: `${issue.key}-parsed-${idx}`,
          text: t.text,
          completed: t.completed,
        }));
        updatedChecklists[issue.key] = taskItems;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      saveChecklistsToDisk(updatedChecklists);
    }
    setAllChecklists(updatedChecklists);
  };

  // Fetch in-progress stories
  const fetchIssues = async () => {
    setLoading(true);
    setError(null);
    const jiraConfig = loadConfig();
    const { url, token, email } = jiraConfig;

    // Pre-load disk cache
    const loadedChecklists = loadChecklistsFromDisk();
    setAllChecklists(loadedChecklists);

    if (url && token && email) {
      // Live Jira API Mode
      try {
        setIsLive(true);
        const auth = Buffer.from(`${email}:${token}`).toString('base64');
        const headers = {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        };

        // Query active "In Progress" stories
        const jql = encodeURIComponent('statusCategory = "In Progress" order by updated desc');
        const searchUrl = `${url.replace(/\/$/, '')}/rest/api/3/search?jql=${jql}&maxResults=15`;
        
        const res = await fetch(searchUrl, { headers });
        if (!res.ok) {
          throw new Error(`Jira API request failed (${res.status}): ${res.statusText}`);
        }
        
        const data: any = await res.json();
        if (!data.issues || !Array.isArray(data.issues)) {
          throw new Error('Invalid Jira search API response format');
        }

        const list: JiraIssue[] = data.issues.map((issue: any) => {
          let desc = '';
          try {
            if (issue.fields.description && typeof issue.fields.description === 'object') {
              // ADF (Atlassian Document Format) parsing helper
              desc = issue.fields.description.content
                ?.map((c: any) => c.content?.map((inner: any) => inner.text).join(''))
                .join('\n') || '';
            } else if (typeof issue.fields.description === 'string') {
              desc = issue.fields.description;
            }
          } catch {}

          return {
            key: issue.key,
            summary: issue.fields.summary || '',
            status: issue.fields.status?.name || 'In Progress',
            priority: issue.fields.priority?.name || 'Medium',
            description: desc || 'No description provided.'
          };
        });

        setIssues(list);
        syncIssuesWithChecklists(list, loadedChecklists);

        if (list.length > 0) {
          setActiveIssue(list[0]);
          setSelectedIndex(0);
        } else {
          setActiveIssue(null);
          setSelectedIndex(0);
        }
      } catch (err: any) {
        setError(err.message);
        // Fallback to mock issues in case of network/credentials failures
        setupMockIssues(loadedChecklists);
      } finally {
        setLoading(false);
      }
    } else {
      // Mock Offline Mode
      setupMockIssues(loadedChecklists);
    }
  };

  const setupMockIssues = (loadedChecklists: Record<string, TaskItem[]>) => {
    setIsLive(false);
    const mockIssues: JiraIssue[] = [
      {
        key: 'ENG-452',
        summary: 'Implement Plugin Auto-Discovery Engine',
        status: 'In Progress',
        priority: 'High',
        description: `We need to implement a dynamic auto-discovery engine for Swiss plugins.
        
        Acceptance Criteria:
        - [ ] Scan the src/plugins/ directory for all .tsx files
        - [ ] Detect and load plugins inside the local .swiss/plugins/ workspace folder
        - [ ] Validate that loaded modules export name, description, and default component
        - [ ] Expose discovered plugins dynamically to the main Swiss CLI menu`
      },
      {
        key: 'ENG-312',
        summary: 'Upgrade request plugin UI styling',
        status: 'In Progress',
        priority: 'High',
        description: `Improve the request workbench plugin to be competitive with modern TUI styling.
        
        Tasks to complete:
        - Support active Tab modes (COLLECTIONS, EDITOR, RESPONSE)
        - Add latency measurement in milliseconds and response size tracking
        - Integrate scrollable layout within response view container
        - Design HSL-based colored highlights for status badges and HTTP methods`
      },
      {
        key: 'ENG-105',
        summary: 'Refactor state manager for workspace files',
        status: 'In Progress',
        priority: 'Medium',
        description: `The current workspace file tracker is inefficient.
        Implement memory optimizations. Build detailed performance loggers. Setup local cache triggers to avoid repeating file reads. Ensure compatibility with zsh terminal dimensions.`
      },
      {
        key: 'ENG-210',
        summary: 'Update developer guides',
        status: 'In Progress',
        priority: 'Low',
        description: 'The developer guides need some minor copy edits before release.'
      }
    ];

    setIssues(mockIssues);
    syncIssuesWithChecklists(mockIssues, loadedChecklists);

    setActiveIssue(mockIssues[0]);
    setSelectedIndex(0);
    setLoading(false);
  };

  // Load checklists from disk and fetch issues on mount
  useEffect(() => {
    fetchIssues();
  }, []);

  // Sync selected index when active issue changes
  useEffect(() => {
    setChecklistSelectedIndex(0);
  }, [activeIssue]);

  const currentChecklist = activeIssue ? (allChecklists[activeIssue.key] || []) : [];

  const handleAddTaskSubmit = () => {
    if (activeIssue && newTaskText.trim()) {
      const key = activeIssue.key;
      const newItems: TaskItem[] = [
        ...currentChecklist,
        {
          id: `${key}-custom-${Date.now()}`,
          text: newTaskText.trim(),
          completed: false,
          custom: true
        }
      ];
      const updated = { ...allChecklists, [key]: newItems };
      setAllChecklists(updated);
      saveChecklistsToDisk(updated);
    }
    setMode('VIEW');
    setNewTaskText('');
  };

  // Sizing and layout calculation
  const hasWarningBanner = !isLive;
  const hasError = !!error;
  let reservedRows = 8;
  if (hasWarningBanner) reservedRows += 4;
  if (hasError) reservedRows += 3;

  const maxVisibleList = Math.max(5, size.rows - reservedRows - 4);
  const maxVisibleChecklist = Math.max(5, size.rows - reservedRows - 7);

  // Mouse event coordinates tracking
  useMouse((event) => {
    if (loading || mode !== 'VIEW') return;

    const columns = size.columns;
    const isLeftPane = event.x < Math.floor(columns * 0.42);

    if (event.type === 'left_click') {
      if (isLeftPane) {
        setFocusedPane('STORIES');
        const offsetY = hasWarningBanner ? 10 : 6;
        let start = 0;
        if (selectedIndex >= maxVisibleList) {
          start = selectedIndex - Math.floor(maxVisibleList / 2);
          if (start + maxVisibleList > issues.length) {
            start = issues.length - maxVisibleList;
          }
        }
        start = Math.max(0, start);
        const actualIdx = start + (event.y - offsetY);
        
        if (actualIdx >= 0 && actualIdx < issues.length && event.y >= offsetY && event.y < offsetY + Math.min(issues.length, maxVisibleList)) {
          setSelectedIndex(actualIdx);
          setActiveIssue(issues[actualIdx]);
        }
      } else {
        setFocusedPane('CHECKLIST');
        if (!activeIssue) return;
        
        const offsetY = (hasWarningBanner ? 12 : 8) + (hasError ? 3 : 0);
        let start = 0;
        if (checklistSelectedIndex >= maxVisibleChecklist) {
          start = checklistSelectedIndex - Math.floor(maxVisibleChecklist / 2);
          if (start + maxVisibleChecklist > currentChecklist.length) {
            start = currentChecklist.length - maxVisibleChecklist;
          }
        }
        start = Math.max(0, start);
        const actualIdx = start + (event.y - offsetY);
        
        if (actualIdx >= 0 && actualIdx < currentChecklist.length && event.y >= offsetY && event.y < offsetY + Math.min(currentChecklist.length, maxVisibleChecklist)) {
          setChecklistSelectedIndex(actualIdx);
          // Toggle completion status
          const key = activeIssue.key;
          const updatedChecklist = currentChecklist.map((item, idx) => {
            if (idx === actualIdx) {
              return { ...item, completed: !item.completed };
            }
            return item;
          });
          const updatedAll = { ...allChecklists, [key]: updatedChecklist };
          setAllChecklists(updatedAll);
          saveChecklistsToDisk(updatedAll);
        }
      }
    } else if (event.type === 'scroll_up') {
      if (isLeftPane) {
        setSelectedIndex((prev) => {
          const next = Math.max(0, prev - 1);
          if (issues[next]) setActiveIssue(issues[next]);
          return next;
        });
      } else {
        setChecklistSelectedIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (event.type === 'scroll_down') {
      if (isLeftPane) {
        setSelectedIndex((prev) => {
          const next = Math.min(issues.length - 1, prev + 1);
          if (issues[next]) setActiveIssue(issues[next]);
          return next;
        });
      } else {
        setChecklistSelectedIndex((prev) => Math.min(currentChecklist.length - 1, prev + 1));
      }
    }
  });

  // Keyboard navigation hook
  useInput((input, key) => {
    if (loading) return;

    if (mode === 'ADD_TASK') {
      if (key.escape) {
        setMode('VIEW');
        setNewTaskText('');
      }
      return;
    }

    if (mode === 'VIEW') {
      // Focus swapping
      if (key.tab || key.leftArrow || key.rightArrow) {
        setFocusedPane(prev => prev === 'STORIES' ? 'CHECKLIST' : 'STORIES');
        return;
      }

      // Left pane controls
      if (focusedPane === 'STORIES') {
        if (key.downArrow && issues.length > 0) {
          const nextIdx = Math.min(selectedIndex + 1, issues.length - 1);
          setSelectedIndex(nextIdx);
          setActiveIssue(issues[nextIdx]);
        }
        if (key.upArrow && issues.length > 0) {
          const nextIdx = Math.max(selectedIndex - 1, 0);
          setSelectedIndex(nextIdx);
          setActiveIssue(issues[nextIdx]);
        }
        if (input === 'r') {
          fetchIssues();
        }
      }

      // Right pane controls
      if (focusedPane === 'CHECKLIST' && activeIssue) {
        if (key.downArrow && currentChecklist.length > 0) {
          setChecklistSelectedIndex(prev => Math.min(prev + 1, currentChecklist.length - 1));
        }
        if (key.upArrow && currentChecklist.length > 0) {
          setChecklistSelectedIndex(prev => Math.max(prev - 1, 0));
        }
        if ((input === ' ' || key.return) && currentChecklist.length > 0) {
          const keyStr = activeIssue.key;
          const updatedChecklist = currentChecklist.map((item, idx) => {
            if (idx === checklistSelectedIndex) {
              return { ...item, completed: !item.completed };
            }
            return item;
          });
          const updatedAll = { ...allChecklists, [keyStr]: updatedChecklist };
          setAllChecklists(updatedAll);
          saveChecklistsToDisk(updatedAll);
        }
        if (input === 'a') {
          setMode('ADD_TASK');
          setNewTaskText('');
        }
        if ((input === 'd' || key.delete) && currentChecklist.length > 0) {
          const keyStr = activeIssue.key;
          const updatedChecklist = currentChecklist.filter((_, idx) => idx !== checklistSelectedIndex);
          const updatedAll = { ...allChecklists, [keyStr]: updatedChecklist };
          setAllChecklists(updatedAll);
          saveChecklistsToDisk(updatedAll);
          setChecklistSelectedIndex(prev => Math.max(0, Math.min(prev, updatedChecklist.length - 1)));
        }
        if (input === 'r') {
          // Force re-parse description and merge manual tasks
          const newParsed = parseDescription(activeIssue.description, activeIssue.summary);
          const customItems = currentChecklist.filter(item => item.custom);
          const keyStr = activeIssue.key;
          const newItems: TaskItem[] = [
            ...newParsed.map((t, idx) => ({
              id: `${keyStr}-${idx}-${Date.now()}`,
              text: t.text,
              completed: t.completed,
            })),
            ...customItems
          ];
          const updatedAll = { ...allChecklists, [keyStr]: newItems };
          setAllChecklists(updatedAll);
          saveChecklistsToDisk(updatedAll);
          setChecklistSelectedIndex(0);
        }
      }
    }
  });

  const totalTasks = currentChecklist.length;
  const completedTasks = currentChecklist.filter(t => t.completed).length;
  const percent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const renderProgressBar = () => {
    if (totalTasks === 0) return null;
    const barWidth = 15;
    const completedWidth = Math.round((completedTasks / totalTasks) * barWidth);
    const remainingWidth = barWidth - completedWidth;
    const filledStr = '█'.repeat(completedWidth);
    const emptyStr = '░'.repeat(remainingWidth);
    return (
      <Box flexDirection="row" marginBottom={1}>
        <Text bold color="blue">Progress: </Text>
        <Text color="white">[{filledStr}{emptyStr}] {percent}% ({completedTasks}/{totalTasks})</Text>
      </Box>
    );
  };

  if (loading) {
    return (
      <Layout>
        <Header title="Checklist Workbench" />
        <Text color="yellow">Retrieving In-Progress issues from Jira...</Text>
      </Layout>
    );
  }

  const getIndicator = (isSelected: boolean) => {
    if (!isSelected) return '  ';
    return focusedPane === 'STORIES' ? '▶ ' : '▷ ';
  };

  return (
    <Layout>
      <Header title={`Checklist Workbench [${isLive ? 'LIVE' : 'MOCK'}]`} />

      {!isLive && (
        <Box marginBottom={1} paddingX={1} borderStyle="classic" borderColor="yellow">
          <Text color="yellow" bold>💡 Offline mock mode. Set "jira.url", "jira.token", and "jira.email" in swiss config to sync live!</Text>
        </Box>
      )}

      {error && (
        <Box marginBottom={1} paddingX={1} borderStyle="single" borderColor="red">
          <Text color="red">Jira Connection Failed: {error}</Text>
        </Box>
      )}

      <Box flexDirection="row" flexGrow={1}>
        {/* Left Pane: Stories */}
        <Box width="40%" marginRight={1}>
          <Card 
            title={`Active Stories (${issues.length})`} 
            borderColor={focusedPane === 'STORIES' ? 'cyan' : 'gray'} 
            width="100%"
          >
            <ScrollableList 
              items={issues}
              selectedIndex={selectedIndex}
              renderItem={(issue, isSelected) => (
                <Box key={issue.key} flexDirection="row" justifyContent="space-between">
                  <Text color={isSelected ? (focusedPane === 'STORIES' ? 'cyan' : 'white') : 'white'} bold={isSelected}>
                    {getIndicator(isSelected)}{issue.key}
                  </Text>
                  <StatusBadge status={issue.status} />
                </Box>
              )}
              maxVisible={maxVisibleList}
            />
          </Card>
        </Box>

        {/* Right Pane: Checklist */}
        <Box width="60%">
          <Card 
            title="Interactive Checklist" 
            borderColor={focusedPane === 'CHECKLIST' ? 'blue' : 'gray'} 
            width="100%"
          >
            {activeIssue ? (
              <Box flexDirection="column" height="100%" flexGrow={1}>
                {/* Active issue title */}
                <Box marginBottom={1}>
                  <Text bold color="blue">{activeIssue.key}: {activeIssue.summary}</Text>
                </Box>
                
                {/* Progress bar */}
                {renderProgressBar()}

                {/* Checklist list */}
                <Box flexGrow={1} minHeight={4}>
                  <ScrollableList
                    items={currentChecklist}
                    selectedIndex={checklistSelectedIndex}
                    renderItem={(item, isSelected) => {
                      const isItemFocused = isSelected && focusedPane === 'CHECKLIST';
                      const checkboxStr = `[${item.completed ? '✓' : ' '}]`;
                      
                      return (
                        <Box key={item.id} flexDirection="row" justifyContent="space-between">
                          <Box flexDirection="row" flexShrink={1}>
                            <Text color={isItemFocused ? 'blue' : 'white'} bold={isItemFocused}>
                              {isItemFocused ? '▶ ' : '  '}
                            </Text>
                            <Text 
                              color={item.completed ? 'gray' : (isItemFocused ? 'blue' : 'white')} 
                              strikethrough={item.completed}
                              bold={isItemFocused}
                            >
                              {checkboxStr} {item.text}
                            </Text>
                          </Box>
                          {item.custom && (
                            <Text color="yellow" dimColor>[custom]</Text>
                          )}
                        </Box>
                      );
                    }}
                    maxVisible={maxVisibleChecklist}
                  />
                </Box>

                {/* Inline text input for adding manual subtask */}
                {mode === 'ADD_TASK' && (
                  <Box marginTop={1}>
                    <TextInputField
                      label="Add Custom Subtask"
                      value={newTaskText}
                      onChange={setNewTaskText}
                      onSubmit={handleAddTaskSubmit}
                      placeholder="Type custom task and press Enter..."
                      showFocusBorder={true}
                    />
                  </Box>
                )}
              </Box>
            ) : (
              <Text color="gray">No In-Progress stories available.</Text>
            )}
          </Card>
        </Box>
      </Box>

      {/* Footer / Instruction Keys */}
      {mode === 'VIEW' && (
        <Footer 
          keys={[
            { key: 'Tab/←/→', desc: 'Switch Pane' },
            { key: '↑/↓', desc: 'Scroll Focused' },
            focusedPane === 'STORIES' 
              ? { key: 'r', desc: 'Sync Jira' } 
              : { key: 'Space/Enter', desc: 'Toggle Done' },
            focusedPane === 'CHECKLIST' ? { key: 'a', desc: 'Add Task' } : { key: '', desc: '' },
            focusedPane === 'CHECKLIST' ? { key: 'd/Del', desc: 'Delete Task' } : { key: '', desc: '' },
            focusedPane === 'CHECKLIST' ? { key: 'r', desc: 'Reset Heuristics' } : { key: '', desc: '' },
            { key: 'q', desc: 'Quit' }
          ].filter(k => k.key)}
        />
      )}

      {mode === 'ADD_TASK' && (
        <Footer 
          keys={[
            { key: 'Enter', desc: 'Save Subtask' },
            { key: 'Esc', desc: 'Cancel' }
          ]}
        />
      )}
    </Layout>
  );
};

export default TasksPlugin;
