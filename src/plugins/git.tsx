import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { execa } from 'execa';
import chalk from 'chalk';
import { Header, Layout, Card, ScrollableList, Footer, StatusBadge, TextInputField, useTerminalSize, useMouse } from '../components/UI.js';
import { PluginProps } from '../core/types.js';

type ViewMode = 'STATUS' | 'BRANCH_LIST' | 'COMMIT_INPUT' | 'NEW_BRANCH_INPUT' | 'COMMIT_LOG' | 'DIFF';

interface GitFile {
  path: string;
  staged: boolean;
  status: string;
}

interface GitCommit {
  hash: string;
  author: string;
  date: string;
  msg: string;
}

const GitPlugin: React.FC<PluginProps> = ({ suppressQuit }) => {
  const size = useTerminalSize();
  const maxVisibleList = Math.max(5, size.rows - 10);
  const [mode, setMode] = useState<ViewMode>('STATUS');

  // Handle global quit suppression when typing input
  useEffect(() => {
    if (suppressQuit) {
      suppressQuit(mode === 'COMMIT_INPUT' || mode === 'NEW_BRANCH_INPUT');
    }
    return () => {
      if (suppressQuit) suppressQuit(false);
    };
  }, [mode, suppressQuit]);
  const [branch, setBranch] = useState('');
  const [files, setFiles] = useState<GitFile[]>([]);
  const [branches, setBranches] = useState<{ label: string; value: string }[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [selectedCommitIndex, setSelectedCommitIndex] = useState(0);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [commitMsg, setCommitMsg] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);

  // Diff states
  const [diffLines, setDiffLines] = useState<string[]>([]);
  const [diffScrollIndex, setDiffScrollIndex] = useState(0);
  const [diffFileName, setDiffFileName] = useState('');

  useMouse((event) => {
    if (loading) return;

    if (event.type === 'scroll_up') {
      if (mode === 'STATUS') {
        setSelectedFileIndex((prev) => Math.max(0, prev - 1));
      } else if (mode === 'COMMIT_LOG') {
        setSelectedCommitIndex((prev) => Math.max(0, prev - 1));
      } else if (mode === 'DIFF') {
        setDiffScrollIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (event.type === 'scroll_down') {
      if (mode === 'STATUS') {
        setSelectedFileIndex((prev) => Math.min(files.length - 1, prev + 1));
      } else if (mode === 'COMMIT_LOG') {
        setSelectedCommitIndex((prev) => Math.min(commits.length - 1, prev + 1));
      } else if (mode === 'DIFF') {
        setDiffScrollIndex((prev) => Math.min(diffLines.length - 1, prev + 1));
      }
    }
  });

  const refreshStatus = async () => {
    try {
      setLoading(true);
      setGitError(null);

      // Verify inside a git workspace
      try {
        await execa('git', ['rev-parse', '--is-inside-work-tree']);
      } catch (e) {
        setGitError('Not a git repository (or any of the parent directories)');
        setLoading(false);
        return;
      }

      const { stdout: branchOut } = await execa('git', ['branch', '--show-current']);
      setBranch(branchOut.trim());

      const { stdout: statusOut } = await execa('git', ['status', '--porcelain']);
      const parsedFiles: GitFile[] = statusOut.split('\n').filter(Boolean).map(line => {
        const status = line.slice(0, 2);
        const path = line.slice(3);
        const staged = status[0] !== ' ' && status[0] !== '?';
        return { path, staged, status };
      });
      setFiles(parsedFiles);
      
      // Keep selectedIndex within bounds
      if (parsedFiles.length === 0) {
        setSelectedFileIndex(0);
      } else {
        setSelectedFileIndex(prev => Math.min(prev, parsedFiles.length - 1));
      }
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const { stdout } = await execa('git', ['branch', '--format=%(refname:short)']);
      const list = stdout.split('\n').filter(Boolean).map(b => ({ label: b, value: b }));
      setBranches(list);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const fetchCommits = async () => {
    try {
      setLoading(true);
      const { stdout } = await execa('git', ['log', '--pretty=format:%h|%an|%ar|%s', '-n', '20']);
      const list = stdout.split('\n').filter(Boolean).map(line => {
        const parts = line.split('|');
        return {
          hash: parts[0] || '',
          author: parts[1] || '',
          date: parts[2] || '',
          msg: parts.slice(3).join('|') || ''
        };
      });
      setCommits(list);
      setSelectedCommitIndex(0);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchDiff = async (file: GitFile) => {
    try {
      setLoading(true);
      const args = file.staged ? ['diff', '--staged', file.path] : ['diff', file.path];
      const { stdout } = await execa('git', args);
      if (!stdout.trim()) {
        setDiffLines(['No changes detected or binary file.']);
      } else {
        const colored = stdout.split('\n').map((line) => {
          if (line.startsWith('+') && !line.startsWith('+++')) {
            return chalk.green(line);
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            return chalk.red(line);
          } else if (line.startsWith('@@') || line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++')) {
            return chalk.cyan(line);
          }
          return line;
        });
        setDiffLines(colored);
      }
      setDiffScrollIndex(0);
    } catch (err: any) {
      setDiffLines([chalk.red(`Error loading diff: ${err.message}`)]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshStatus();
  }, []);

  const stagedFiles = files.filter(f => f.staged);
  const unstagedFiles = files.filter(f => !f.staged);
  const totalFilesCount = files.length;

  useInput(async (input, key) => {
    if (mode === 'STATUS') {
      if (key.downArrow && totalFilesCount > 0) {
        setSelectedFileIndex((prev) => Math.min(prev + 1, totalFilesCount - 1));
      }
      if (key.upArrow && totalFilesCount > 0) {
        setSelectedFileIndex((prev) => Math.max(prev - 1, 0));
      }
      if (input === 'r') refreshStatus();
      if (input === 'b') {
        await fetchBranches();
        setMode('BRANCH_LIST');
      }
      if (input === 'B') setMode('NEW_BRANCH_INPUT');
      if (input === 'c') setMode('COMMIT_INPUT');
      if (input === 'l') {
        await fetchCommits();
        setMode('COMMIT_LOG');
      }
      
      // Interactive Single File Stage / Unstage
      if (input === ' ' || input === 's') {
        if (totalFilesCount > 0) {
          const fileToToggle = files[selectedFileIndex];
          if (fileToToggle.staged) {
            await execa('git', ['restore', '--staged', fileToToggle.path]);
          } else {
            await execa('git', ['add', fileToToggle.path]);
          }
          await refreshStatus();
        }
      }

      // Stage All / Unstage All
      if (input === 'S') {
        await execa('git', ['add', '.']);
        await refreshStatus();
      }
      if (input === 'U') {
        await execa('git', ['restore', '--staged', '.']);
        await refreshStatus();
      }

      if (input === 'd') {
        const fileToDiff = files[selectedFileIndex];
        if (fileToDiff) {
          setDiffFileName(fileToDiff.path);
          await fetchDiff(fileToDiff);
          setMode('DIFF');
        }
      }
      if (input === 'f') {
        setLoading(true);
        await execa('git', ['fetch', '--prune']);
        await refreshStatus();
      }
      if (input === 'P') {
        setLoading(true);
        await execa('git', ['push']);
        await refreshStatus();
      }
      if (input === 'p') {
        setLoading(true);
        await execa('git', ['pull']);
        await refreshStatus();
      }
    } else if (mode === 'DIFF') {
      if (key.downArrow && diffLines.length > 0) {
        setDiffScrollIndex((prev) => Math.min(prev + 1, diffLines.length - 1));
      }
      if (key.upArrow && diffLines.length > 0) {
        setDiffScrollIndex((prev) => Math.max(prev - 1, 0));
      }
      if (key.escape || input === 'd') {
        setMode('STATUS');
      }
    } else if (mode === 'COMMIT_LOG') {
      if (key.downArrow && commits.length > 0) {
        setSelectedCommitIndex((prev) => Math.min(prev + 1, commits.length - 1));
      }
      if (key.upArrow && commits.length > 0) {
        setSelectedCommitIndex((prev) => Math.max(prev - 1, 0));
      }
      if (key.escape) {
        setMode('STATUS');
      }
    } else if (key.escape) {
      setMode('STATUS');
    }
  });

  const handleBranchSelect = async (item: { value: string }) => {
    try {
      setLoading(true);
      await execa('git', ['checkout', item.value]);
      setMode('STATUS');
      refreshStatus();
    } catch (err: any) {
      setError(err.message);
      setMode('STATUS');
      setLoading(false);
    }
  };

  const handleCommitSubmit = async () => {
    if (!commitMsg) return;
    try {
      setLoading(true);
      await execa('git', ['commit', '-m', commitMsg]);
      setCommitMsg('');
      setMode('STATUS');
      refreshStatus();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleNewBranchSubmit = async () => {
    if (!newBranchName) return;
    try {
      setLoading(true);
      await execa('git', ['checkout', '-b', newBranchName]);
      setNewBranchName('');
      setMode('STATUS');
      refreshStatus();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (gitError) {
    return (
      <Layout>
        <Header title="Git Client" />
        <Card title="Fatal Error" borderColor="red" flexGrow={1}>
          <Box paddingY={1} flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <StatusBadge status="Error" />
            <Box marginTop={1}>
              <Text color="red" bold>Fatal: {gitError}</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">The Git plugin requires an active local Git repository context.</Text>
            </Box>
          </Box>
        </Card>
        <Footer keys={[{ key: 'q', desc: 'Quit' }]} />
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <Header title="Git Error" />
        <Card title="Error Message" borderColor="red">
          <Text color="red">{error}</Text>
        </Card>
        <Footer keys={[{ key: 'r', desc: 'Retry' }, { key: 'q', desc: 'Quit' }]} />
      </Layout>
    );
  }

  if (loading && (mode === 'STATUS' || mode === 'COMMIT_LOG')) {
    return (
      <Layout>
        <Header title="Git" />
        <Text color="yellow">Loading Git data...</Text>
      </Layout>
    );
  }

  return (
    <Layout>
      <Header title={`Git [Branch: ${branch}]`} />

      {mode === 'STATUS' && (
        <>
          <Box flexDirection="row" flexGrow={1}>
            {/* Staged Pane */}
            <Box width="50%" marginRight={1} flexGrow={1}>
              <Card title={`Staged Changes (${stagedFiles.length})`} borderColor="green" width="100%">
                <ScrollableList 
                  items={stagedFiles}
                  selectedIndex={selectedFileIndex < stagedFiles.length ? selectedFileIndex : -1}
                  renderItem={(item, isSelected) => (
                    <Text key={item.path} color={isSelected ? 'cyan' : 'green'}>
                      {isSelected ? '▶ ' : '  '}{item.status} {item.path}
                    </Text>
                  )}
                  maxVisible={maxVisibleList}
                />
              </Card>
            </Box>

            {/* Unstaged Pane */}
            <Box width="50%" flexGrow={1}>
              <Card title={`Unstaged Changes (${unstagedFiles.length})`} borderColor="yellow" width="100%">
                <ScrollableList 
                  items={unstagedFiles}
                  selectedIndex={selectedFileIndex >= stagedFiles.length ? selectedFileIndex - stagedFiles.length : -1}
                  renderItem={(item, isSelected) => (
                    <Text key={item.path} color={isSelected ? 'cyan' : 'yellow'}>
                      {isSelected ? '▶ ' : '  '}{item.status} {item.path}
                    </Text>
                  )}
                  maxVisible={maxVisibleList}
                />
              </Card>
            </Box>
          </Box>

          <Footer 
            keys={[
              { key: '↑/↓', desc: 'Navigate files' },
              { key: 'Space/s', desc: 'Toggle stage' },
              { key: 'd', desc: 'View Diff' },
              { key: 'S', desc: 'Stage All' },
              { key: 'U', desc: 'Unstage All' },
              { key: 'c', desc: 'Commit' },
              { key: 'l', desc: 'Log history' },
              { key: 'b', desc: 'Branches' },
              { key: 'B', desc: 'New Branch' },
              { key: 'p/P', desc: 'Pull/Push' },
              { key: 'f', desc: 'Fetch' },
              { key: 'r', desc: 'Refresh' }
            ]}
          />
        </>
      )}

      {mode === 'DIFF' && (
        <>
          <Card title={`Git Diff: ${diffFileName}`} borderColor="cyan" flexGrow={1}>
            <ScrollableList 
              items={diffLines}
              selectedIndex={diffScrollIndex}
              renderItem={(line) => (
                <Text key={Math.random()} color="white">{line || ' '}</Text>
              )}
              maxVisible={maxVisibleList + 2}
            />
          </Card>
          
          <Footer 
            keys={[
              { key: '↑/↓', desc: 'Scroll diff' },
              { key: 'Esc/d', desc: 'Back to Status' }
            ]}
          />
        </>
      )}

      {mode === 'COMMIT_LOG' && (
        <>
          <Card title="Git Commit Log (Last 20 commits)" borderColor="cyan" flexGrow={1}>
            <ScrollableList 
              items={commits}
              selectedIndex={selectedCommitIndex}
              renderItem={(item, isSelected) => (
                <Text key={item.hash} wrap="truncate" color={isSelected ? 'cyan' : 'white'}>
                  {isSelected ? '▶ ' : '  '}
                  <Text color="yellow">{item.hash}</Text>
                  <Text color="gray"> ({item.date})</Text>
                  <Text bold color="white"> {item.msg}</Text>
                  <Text color="gray" dimColor> @{item.author}</Text>
                </Text>
              )}
              maxVisible={maxVisibleList + 2}
            />
          </Card>
          
          <Footer 
            keys={[
              { key: '↑/↓', desc: 'Scroll log' },
              { key: 'Esc', desc: 'Back to Status' }
            ]}
          />
        </>
      )}

      {mode === 'BRANCH_LIST' && (
        <Box flexDirection="column" width="100%">
          <Card title="Switch Branch" borderColor="cyan">
            <Box paddingY={1}>
              <SelectInput items={branches} onSelect={handleBranchSelect} />
            </Box>
          </Card>
          <Footer keys={[{ key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}

      {mode === 'NEW_BRANCH_INPUT' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Create New Branch" 
            value={newBranchName} 
            onChange={setNewBranchName} 
            onSubmit={handleNewBranchSubmit}
            placeholder="Enter new branch name..."
          />
          <Footer keys={[{ key: 'Enter', desc: 'Create branch' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}

      {mode === 'COMMIT_INPUT' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Commit Changes" 
            value={commitMsg} 
            onChange={setCommitMsg} 
            onSubmit={handleCommitSubmit}
            placeholder="Enter commit message..."
          />
          <Footer keys={[{ key: 'Enter', desc: 'Submit commit' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}
    </Layout>
  );
};

export default GitPlugin;
