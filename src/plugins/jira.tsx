import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import fetch from 'node-fetch';
import { Header, Layout, Card, ScrollableList, Footer, StatusBadge, TextInputField, useTerminalSize, useMouse } from '../components/UI.js';
import { PluginProps } from '../core/types.js';

export const name = 'Jira';
export const description = 'Jira sprint active board and issue monitor';
export const configFields = [
  { key: 'url', label: 'Jira Instance URL', description: 'e.g. "https://your-org.atlassian.net"' },
  { key: 'token', label: 'Jira API Token', description: 'API Token generated in Atlassian profile' },
  { key: 'email', label: 'Jira Account Email', description: 'Email address linked to Jira account' }
];

interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  description: string;
}

type Mode = 'VIEW' | 'TRANSITION' | 'FILTER_INPUT';

interface JqlFilter {
  label: string;
  jql: string;
}

const JQL_FILTERS: JqlFilter[] = [
  { label: 'Assigned to Me', jql: 'assignee = currentUser() AND statusCategory != Done order by updated desc' },
  { label: 'All Open Issues', jql: 'statusCategory != Done order by updated desc' },
  { label: 'Done', jql: 'statusCategory = Done order by updated desc' }
];

const JiraPlugin: React.FC<PluginProps> = ({ config, suppressQuit }) => {
  const size = useTerminalSize();
  const maxVisibleList = Math.max(4, size.rows - (config['jira.url'] ? 10 : 13));

  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [activeIssue, setActiveIssue] = useState<JiraIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('VIEW');
  const [isLive, setIsLive] = useState(false);
  
  // Real-time local search/filter
  const [searchQuery, setSearchQuery] = useState('');

  // Handle global quit suppression when searching
  useEffect(() => {
    if (suppressQuit) {
      suppressQuit(mode === 'FILTER_INPUT');
    }
    return () => {
      if (suppressQuit) suppressQuit(false);
    };
  }, [mode, suppressQuit]);
  
  // Active JQL Filter index
  const [currentFilterIndex, setCurrentFilterIndex] = useState(0);

  useMouse((event) => {
    if (mode !== 'VIEW' || loading) return;

    if (event.type === 'scroll_up') {
      const nextIdx = Math.max(selectedIndex - 1, 0);
      setSelectedIndex(nextIdx);
      if (filteredIssues.length > 0) setActiveIssue(filteredIssues[nextIdx]);
    } else if (event.type === 'scroll_down') {
      const nextIdx = Math.min(selectedIndex + 1, filteredIssues.length - 1);
      setSelectedIndex(nextIdx);
      if (filteredIssues.length > 0) setActiveIssue(filteredIssues[nextIdx]);
    }
  });

  const fetchIssues = async () => {
    setLoading(true);
    setError(null);
    const { url, token, email } = config;

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

        const activeJql = JQL_FILTERS[currentFilterIndex].jql;
        const jql = encodeURIComponent(activeJql);
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
          // Parse description
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
            status: issue.fields.status?.name || 'To Do',
            priority: issue.fields.priority?.name || 'Medium',
            description: desc || 'No description provided.'
          };
        });

        setIssues(list);
        if (list.length > 0) {
          setActiveIssue(list[0]);
          setSelectedIndex(0);
        } else {
          setActiveIssue(null);
          setSelectedIndex(0);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    } else {
      // Mock Offline Mode
      setIsLive(false);
      setTimeout(() => {
        let mockIssues: JiraIssue[] = [];
        const label = JQL_FILTERS[currentFilterIndex].label;
        if (label === 'Assigned to Me') {
          mockIssues = [
            { 
              key: 'ENG-452', 
              summary: 'Implement Plugin Auto-Discovery Engine', 
              status: 'In Progress', 
              priority: 'High', 
              description: 'Scans both standard src/plugins/ and local directory .swiss/plugins/ for module dynamic imports.' 
            },
            { 
              key: 'ENG-453', 
              summary: 'Build Premium Common TUI Layout components', 
              status: 'To Do', 
              priority: 'Medium', 
              description: 'Provide developer-friendly reusable structures like styled cards, status badges, and interactive scrolling menus.' 
            },
            { 
              key: 'ENG-454', 
              summary: 'Setup automated CI workflow triggers', 
              status: 'To Do', 
              priority: 'Low', 
              description: 'Draft Github actions configs to test CLI compilations on push and publish distribution packages.' 
            },
            { 
              key: 'ENG-455', 
              summary: 'Add support for live process logging', 
              status: 'In Review', 
              priority: 'High', 
              description: 'Ensure logs monitor plugin can tail local log files or stream from child processes using execa background events.' 
            }
          ];
        } else if (label === 'All Open Issues') {
          mockIssues = [
            { 
              key: 'ENG-452', 
              summary: 'Implement Plugin Auto-Discovery Engine', 
              status: 'In Progress', 
              priority: 'High', 
              description: 'Scans both standard src/plugins/ and local directory .swiss/plugins/ for module dynamic imports.' 
            },
            { 
              key: 'ENG-453', 
              summary: 'Build Premium Common TUI Layout components', 
              status: 'To Do', 
              priority: 'Medium', 
              description: 'Provide developer-friendly reusable structures like styled cards, status badges, and interactive scrolling menus.' 
            },
            { 
              key: 'ENG-454', 
              summary: 'Setup automated CI workflow triggers', 
              status: 'To Do', 
              priority: 'Low', 
              description: 'Draft Github actions configs to test CLI compilations on push and publish distribution packages.' 
            },
            { 
              key: 'ENG-455', 
              summary: 'Add support for live process logging', 
              status: 'In Review', 
              priority: 'High', 
              description: 'Ensure logs monitor plugin can tail local log files or stream from child processes using execa background events.' 
            },
            { 
              key: 'ENG-312', 
              summary: 'Upgrade request plugin UI styling', 
              status: 'In Progress', 
              priority: 'High', 
              description: 'Transform the basic endpoint request input into a beautiful tabbed Postman client with collections support.' 
            },
            { 
              key: 'ENG-101', 
              summary: 'Draft developer documentation and usage guides', 
              status: 'To Do', 
              priority: 'Medium', 
              description: 'Create comprehensive user-facing guides explaining how to install, build, configure, and develop custom plugins for Swiss.' 
            }
          ];
        } else {
          // Done
          mockIssues = [
            { 
              key: 'ENG-201', 
              summary: 'Initial setup of Swiss terminal frame', 
              status: 'Done', 
              priority: 'Medium', 
              description: 'Configured base ink container with global layout and resize listener triggers.' 
            },
            { 
              key: 'ENG-199', 
              summary: 'Establish TypeScript tsconfig compilation configurations', 
              status: 'Done', 
              priority: 'Low', 
              description: 'Completed tsconfig files and npm script shortcuts.' 
            }
          ];
        }
        setIssues(mockIssues);
        if (mockIssues.length > 0) {
          setActiveIssue(mockIssues[0]);
          setSelectedIndex(0);
        } else {
          setActiveIssue(null);
          setSelectedIndex(0);
        }
        setLoading(false);
      }, 300);
    }
  };

  useEffect(() => {
    fetchIssues();
  }, [config, currentFilterIndex]);

  // Filter issues locally based on search query
  const filteredIssues = issues.filter(issue => 
    !searchQuery || 
    issue.key.toLowerCase().includes(searchQuery.toLowerCase()) || 
    issue.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
    issue.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sync activeIssue when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
    if (filteredIssues.length > 0) {
      setActiveIssue(filteredIssues[0]);
    } else {
      setActiveIssue(null);
    }
  }, [searchQuery]);

  useInput(async (input, key) => {
    if (loading) return;

    if (mode === 'VIEW') {
      if (key.downArrow && filteredIssues.length > 0) {
        const nextIdx = Math.min(selectedIndex + 1, filteredIssues.length - 1);
        setSelectedIndex(nextIdx);
        setActiveIssue(filteredIssues[nextIdx]);
      }
      if (key.upArrow && filteredIssues.length > 0) {
        const nextIdx = Math.max(selectedIndex - 1, 0);
        setSelectedIndex(nextIdx);
        setActiveIssue(filteredIssues[nextIdx]);
      }
      if (input === 'r') {
        fetchIssues();
      }
      if (input === 'j') {
        setSearchQuery('');
        setCurrentFilterIndex((prev) => (prev + 1) % JQL_FILTERS.length);
      }
      if (input === '/') {
        setMode('FILTER_INPUT');
      }
      if (input === 't' && activeIssue) {
        setMode('TRANSITION');
      }
    } else if (mode === 'TRANSITION') {
      if (key.escape) {
        setMode('VIEW');
      }
    } else if (mode === 'FILTER_INPUT') {
      if (key.escape || key.return) {
        setMode('VIEW');
      }
    }
  });

  const handleTransitionSelect = async (item: { value: string }) => {
    if (!activeIssue) return;

    const { url, token, email } = config;
    if (isLive && url && token && email) {
      try {
        setLoading(true);
        const auth = Buffer.from(`${email}:${token}`).toString('base64');
        const headers = {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        };

        // 1. Get transitions available for issue
        const transUrl = `${url.replace(/\/$/, '')}/rest/api/3/issue/${activeIssue.key}/transitions`;
        const transRes = await fetch(transUrl, { headers });
        if (!transRes.ok) throw new Error('Failed to fetch issue transitions');
        const transData: any = await transRes.json();
        
        const transition = transData.transitions?.find(
          (t: any) => t.name.toLowerCase() === item.value.toLowerCase()
        );

        if (!transition) {
          throw new Error(`Status transition to "${item.value}" is not available for this issue.`);
        }

        // 2. Perform Transition
        const postRes = await fetch(transUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ transition: { id: transition.id } })
        });

        if (!postRes.ok) throw new Error('Transition request rejected by Jira');

        setMode('VIEW');
        await fetchIssues();
      } catch (err: any) {
        setError(err.message);
        setMode('VIEW');
        setLoading(false);
      }
    } else {
      // Mock transition in memory
      const updatedList = issues.map(issue => {
        if (issue.key === activeIssue.key) {
          const updated = { ...issue, status: item.value };
          setActiveIssue(updated);
          return updated;
        }
        return issue;
      });
      setIssues(updatedList);
      setMode('VIEW');
    }
  };

  const handleFilterSubmit = () => {
    setMode('VIEW');
  };

  if (loading) {
    return (
      <Layout>
        <Header title={`Jira Work [${JQL_FILTERS[currentFilterIndex].label}]`} />
        <Text color="yellow">Retrieving issues from Jira...</Text>
      </Layout>
    );
  }

  const transitionOptions = [
    { label: 'To Do', value: 'To Do' },
    { label: 'In Progress', value: 'In Progress' },
    { label: 'In Review', value: 'In Review' },
    { label: 'Done', value: 'Done' }
  ];

  return (
    <Layout>
      <Header title={`Jira Sprint Tasks [${isLive ? 'LIVE' : 'MOCK'} - ${JQL_FILTERS[currentFilterIndex].label}]`} />

      {!isLive && (
        <Box marginBottom={1} paddingX={1} borderStyle="classic" borderColor="yellow">
          <Text color="yellow" bold>💡 Offline mock mode. Set "jira.url", "jira.token", and "jira.email" in swiss config to sync live!</Text>
        </Box>
      )}

      {error && (
        <Box marginBottom={1} paddingX={1} borderStyle="single" borderColor="red">
          <Text color="red">Jira Error: {error}</Text>
        </Box>
      )}

      {mode === 'VIEW' && (
        <>
          <Box flexDirection="row" flexGrow={1}>
            {/* Issue List Pane */}
            <Box width="45%" marginRight={1}>
              <Card title={`Issues (${filteredIssues.length})`} borderColor="cyan" width="100%">
                <ScrollableList 
                  items={filteredIssues}
                  selectedIndex={selectedIndex}
                  renderItem={(issue, isSelected) => (
                    <Box key={issue.key} flexDirection="row" justifyContent="space-between">
                      <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                        {isSelected ? '▶ ' : '  '}{issue.key}
                      </Text>
                      <StatusBadge status={issue.status} />
                    </Box>
                  )}
                  maxVisible={maxVisibleList}
                />
              </Card>
            </Box>

            {/* Details Pane */}
            <Box width="55%">
              <Card title="Issue Details" borderColor="blue" width="100%">
                {activeIssue ? (
                  <Box flexDirection="column" paddingY={0}>
                    <Text bold color="blue">{activeIssue.key}: {activeIssue.summary}</Text>
                    <Box marginTop={1} flexDirection="row">
                      <Text>Status: </Text>
                      <StatusBadge status={activeIssue.status} />
                      <Text>  Priority: </Text>
                      <Text color={activeIssue.priority === 'High' ? 'red' : 'white'} bold>{activeIssue.priority}</Text>
                    </Box>
                    <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1} minHeight={5} flexGrow={1}>
                      <Text color="gray">{activeIssue.description}</Text>
                    </Box>
                  </Box>
                ) : (
                  <Text color="gray">No issues found matching search criteria.</Text>
                )}
              </Card>
            </Box>
          </Box>

          <Box marginTop={1} flexDirection="row" justifyContent="space-between">
            <Box>
              <Text color="gray">
                JQL Query: <Text color="white" bold>{JQL_FILTERS[currentFilterIndex].label}</Text>
              </Text>
            </Box>
            {searchQuery && (
              <Box>
                <Text color="gray">
                  Filter: <Text color="cyan" bold>"{searchQuery}"</Text>
                </Text>
              </Box>
            )}
          </Box>

          <Footer 
            keys={[
              { key: '↑/↓', desc: 'Navigate issues' },
              { key: 't', desc: 'Transition Status' },
              { key: 'j', desc: 'Cycle JQL' },
              { key: '/', desc: 'Filter list' },
              { key: 'r', desc: 'Refresh list' },
              { key: 'q', desc: 'Quit Jira' }
            ]}
          />
        </>
      )}

      {mode === 'TRANSITION' && (
        <Box flexDirection="column" width="100%">
          <Card title={`Transition Issue: ${activeIssue?.key}`} borderColor="cyan">
            <Box paddingY={1}>
              <SelectInput items={transitionOptions} onSelect={handleTransitionSelect} />
            </Box>
          </Card>
          <Footer keys={[{ key: 'Esc', desc: 'Cancel Transition' }]} />
        </Box>
      )}

      {mode === 'FILTER_INPUT' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Filter Issues list (Type and Press Enter/Esc)" 
            value={searchQuery} 
            onChange={setSearchQuery} 
            onSubmit={handleFilterSubmit}
            placeholder="Search key, summary, or description..."
          />
          <Footer keys={[{ key: 'Enter/Esc', desc: 'Apply & Close' }]} />
        </Box>
      )}
    </Layout>
  );
};

export default JiraPlugin;
