import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import { execa } from 'execa';
import chalk from 'chalk';
import { Header, Layout, Card, ScrollableList, Footer, StatusBadge, TextInputField, useTerminalSize, useMouse } from '../components/UI.js';
import { PluginProps } from '../core/types.js';

type ViewMode = 'STATUS' | 'BRANCH_LIST' | 'COMMIT_INPUT' | 'NEW_BRANCH_INPUT' | 'RENAME_BRANCH_INPUT' | 'COMMIT_LOG' | 'DIFF' | 'COMMIT_DIFF' | 'CONFIRMATION';

interface GitFile {
  path: string;
  staged: boolean;
  status: string;
}

interface LogLine {
  isCommit: boolean;
  graphPrefix: string;
  hash: string;
  author: string;
  date: string;
  msg: string;
  raw: string;
}

interface GitBranch {
  name: string;
  upstream: string;
  date: string;
  subject: string;
  isActive: boolean;
  isRemote: boolean;
}

interface ConfirmationState {
  action: 'DELETE_BRANCH' | 'MERGE_BRANCH' | 'RESET_COMMIT' | 'CHECKOUT_COMMIT' | null;
  target: string;
  backMode: ViewMode;
  extraData?: string;
}

const colorizeGraph = (prefix: string) => {
  return prefix.split('').map(char => {
    if (char === '*') return chalk.magenta.bold('●'); // Gorgeous commit node bullet!
    if (char === '|') return chalk.gray('│');       // Modern vertical link character!
    if (char === '\\') return chalk.gray('╲');
    if (char === '/') return chalk.gray('╱');
    if (char === '_') return chalk.gray('─');
    return char;
  }).join('');
};

const GitPlugin: React.FC<PluginProps> = ({ suppressQuit }) => {
  const size = useTerminalSize();
  const maxVisibleList = Math.max(5, size.rows - 10);
  const [mode, setMode] = useState<ViewMode>('STATUS');

  // Handle global quit suppression when typing input
  useEffect(() => {
    if (suppressQuit) {
      suppressQuit(
        mode === 'COMMIT_INPUT' ||
        mode === 'NEW_BRANCH_INPUT' ||
        mode === 'RENAME_BRANCH_INPUT'
      );
    }
    return () => {
      if (suppressQuit) suppressQuit(false);
    };
  }, [mode, suppressQuit]);

  const [branch, setBranch] = useState('');
  const [files, setFiles] = useState<GitFile[]>([]);
  
  // Branch Workbench states
  const [detailedBranches, setDetailedBranches] = useState<GitBranch[]>([]);
  const [selectedBranchIndex, setSelectedBranchIndex] = useState(0);
  
  // Git Commit Graph states
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [selectedCommitIndex, setSelectedCommitIndex] = useState(0);
  
  // Staging / Input states
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [commitMsg, setCommitMsg] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [renameBranchName, setRenameBranchName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);

  // Diff states
  const [diffLines, setDiffLines] = useState<string[]>([]);
  const [diffScrollIndex, setDiffScrollIndex] = useState(0);
  const [diffFileName, setDiffFileName] = useState('');

  // Commit Details (git show) states
  const [commitDiffLines, setCommitDiffLines] = useState<string[]>([]);
  const [commitDiffScrollIndex, setCommitDiffScrollIndex] = useState(0);
  const [commitDiffHash, setCommitDiffHash] = useState('');

  // Safety Confirmation states
  const [confirmState, setConfirmState] = useState<ConfirmationState>({
    action: null,
    target: '',
    backMode: 'STATUS'
  });

  // Sync status indicators
  const [ahead, setAhead] = useState<number | null>(null);
  const [behind, setBehind] = useState<number | null>(null);
  const [hasUpstream, setHasUpstream] = useState(false);

  // Enable full interactive scrolling support across panels
  useMouse((event) => {
    if (loading) return;

    if (event.type === 'scroll_up') {
      if (mode === 'STATUS') {
        setSelectedFileIndex((prev) => Math.max(0, prev - 1));
      } else if (mode === 'COMMIT_LOG') {
        setSelectedCommitIndex((prev) => {
          for (let i = prev - 1; i >= 0; i--) {
            if (logLines[i]?.isCommit) return i;
          }
          return prev;
        });
      } else if (mode === 'DIFF') {
        setDiffScrollIndex((prev) => Math.max(0, prev - 1));
      } else if (mode === 'COMMIT_DIFF') {
        setCommitDiffScrollIndex((prev) => Math.max(0, prev - 1));
      } else if (mode === 'BRANCH_LIST') {
        setSelectedBranchIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (event.type === 'scroll_down') {
      if (mode === 'STATUS') {
        setSelectedFileIndex((prev) => Math.min(files.length - 1, prev + 1));
      } else if (mode === 'COMMIT_LOG') {
        setSelectedCommitIndex((prev) => {
          for (let i = prev + 1; i < logLines.length; i++) {
            if (logLines[i]?.isCommit) return i;
          }
          return prev;
        });
      } else if (mode === 'DIFF') {
        setDiffScrollIndex((prev) => Math.min(diffLines.length - 1, prev + 1));
      } else if (mode === 'COMMIT_DIFF') {
        setCommitDiffScrollIndex((prev) => Math.min(commitDiffLines.length - 1, prev + 1));
      } else if (mode === 'BRANCH_LIST') {
        setSelectedBranchIndex((prev) => Math.min(detailedBranches.length - 1, prev + 1));
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

      // Quick background fetch with 3-second timeout so offline flow is unaffected
      try {
        await execa('git', ['fetch', '--prune'], { timeout: 3000 });
      } catch {}

      const { stdout: branchOut } = await execa('git', ['branch', '--show-current']);
      const currentBranch = branchOut.trim();
      setBranch(currentBranch);

      // Check if upstream tracking branch exists
      let trackingUpstream = false;
      let aheadCount = 0;
      let behindCount = 0;
      try {
        await execa('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
        trackingUpstream = true;

        // Fetch ahead/behind counts
        const { stdout: countsOut } = await execa('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
        const counts = countsOut.trim().split(/\s+/);
        if (counts.length === 2) {
          aheadCount = parseInt(counts[0], 10) || 0;
          behindCount = parseInt(counts[1], 10) || 0;
        }
      } catch (e) {
        trackingUpstream = false;
      }
      setHasUpstream(trackingUpstream);
      setAhead(aheadCount);
      setBehind(behindCount);

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
      setLoading(true);
      const { stdout } = await execa('git', [
        'branch',
        '-a',
        '--format=%(refname:short)|%(upstream:short)|%(committerdate:relative)|%(subject)'
      ]);
      const list: GitBranch[] = stdout.split('\n').filter(Boolean).map((line) => {
        const parts = line.split('|');
        const fullName = parts[0] || '';
        const isRemote = fullName.startsWith('remotes/');
        const name = isRemote ? fullName.replace('remotes/', '') : fullName;
        
        return {
          name,
          upstream: parts[1] || '',
          date: parts[2] || '',
          subject: parts[3] || '',
          isActive: false,
          isRemote
        };
      });

      // Get current active branch
      let currentBranch = '';
      try {
        const { stdout: activeOut } = await execa('git', ['branch', '--show-current']);
        currentBranch = activeOut.trim();
      } catch {}

      // Update active status
      const updatedList = list.map(b => ({
        ...b,
        isActive: b.name === currentBranch && !b.isRemote
      }));

      // Filter out duplicate HEAD pointer ref if any
      const cleanList = updatedList.filter(b => !b.name.includes('/HEAD'));

      setDetailedBranches(cleanList);
      setSelectedBranchIndex(prev => Math.min(prev, cleanList.length - 1));
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCommits = async () => {
    try {
      setLoading(true);
      const { stdout } = await execa('git', [
        'log',
        '--graph',
        '--pretty=format:__COMMIT__%h|%an|%ar|%s',
        '-n',
        '50'
      ]);
      const parsedLines: LogLine[] = stdout.split('\n').map((line) => {
        if (line.includes('__COMMIT__')) {
          const parts = line.split('__COMMIT__');
          const graphPrefix = parts[0] || '';
          const commitParts = parts[1].split('|');
          return {
            isCommit: true,
            graphPrefix,
            hash: commitParts[0] || '',
            author: commitParts[1] || '',
            date: commitParts[2] || '',
            msg: commitParts.slice(3).join('|') || '',
            raw: line
          };
        } else {
          return {
            isCommit: false,
            graphPrefix: line,
            hash: '',
            author: '',
            date: '',
            msg: '',
            raw: line
          };
        }
      });
      setLogLines(parsedLines);
      
      const firstCommitIdx = parsedLines.findIndex(l => l.isCommit);
      setSelectedCommitIndex(firstCommitIdx !== -1 ? firstCommitIdx : 0);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCommitDiff = async (hash: string) => {
    try {
      setLoading(true);
      setCommitDiffHash(hash);
      const { stdout } = await execa('git', ['show', '--stat', '--patch', hash]);
      const lines = stdout.split('\n').map(line => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return chalk.green(line);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          return chalk.red(line);
        } else if (line.startsWith('@@') || line.startsWith('diff') || line.startsWith('index') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('commit ')) {
          return chalk.cyan(line);
        }
        return line;
      });
      setCommitDiffLines(lines);
      setCommitDiffScrollIndex(0);
    } catch (err: any) {
      setCommitDiffLines([chalk.red(`Error loading commit details: ${err.message}`)]);
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
    if (loading) return;

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
      
      // Stage / Unstage Selected File
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
        try {
          let hasTracking = false;
          try {
            await execa('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
            hasTracking = true;
          } catch {}

          if (hasTracking) {
            await execa('git', ['push']);
          } else {
            const { stdout: remoteOut } = await execa('git', ['remote']);
            const remotes = remoteOut.split('\n').filter(Boolean);
            if (remotes.length > 0) {
              const primaryRemote = remotes[0];
              const { stdout: branchOut } = await execa('git', ['branch', '--show-current']);
              const currentBranch = branchOut.trim();
              
              await execa('git', ['push', '--set-upstream', primaryRemote, currentBranch]);
            } else {
              throw new Error('No remote configured. Please add a git remote (e.g. git remote add origin <url>) before pushing.');
            }
          }
          await refreshStatus();
        } catch (err: any) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      }
      if (input === 'p') {
        setLoading(true);
        try {
          let hasTracking = false;
          try {
            await execa('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
            hasTracking = true;
          } catch {}

          if (hasTracking) {
            await execa('git', ['pull']);
          } else {
            const { stdout: remoteOut } = await execa('git', ['remote']);
            const remotes = remoteOut.split('\n').filter(Boolean);
            if (remotes.length > 0) {
              const primaryRemote = remotes[0];
              const { stdout: branchOut } = await execa('git', ['branch', '--show-current']);
              const currentBranch = branchOut.trim();
              
              await execa('git', ['pull', primaryRemote, currentBranch]);
              // Also establish tracking so future pulls/pushes work out of the box!
              await execa('git', ['branch', `--set-upstream-to=${primaryRemote}/${currentBranch}`, currentBranch]);
            } else {
              throw new Error('No remote configured. Cannot pull.');
            }
          }
          await refreshStatus();
        } catch (err: any) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
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
      if (key.downArrow && logLines.length > 0) {
        setSelectedCommitIndex((prev) => {
          for (let i = prev + 1; i < logLines.length; i++) {
            if (logLines[i].isCommit) return i;
          }
          return prev;
        });
      }
      if (key.upArrow && logLines.length > 0) {
        setSelectedCommitIndex((prev) => {
          for (let i = prev - 1; i >= 0; i--) {
            if (logLines[i].isCommit) return i;
          }
          return prev;
        });
      }
      
      const activeLine = logLines[selectedCommitIndex];
      
      if (activeLine && activeLine.isCommit) {
        if (input === 'd' || key.return) {
          await fetchCommitDiff(activeLine.hash);
          setMode('COMMIT_DIFF');
        }
        if (input === 'c') {
          setConfirmState({
            action: 'CHECKOUT_COMMIT',
            target: activeLine.hash,
            backMode: 'COMMIT_LOG',
            extraData: activeLine.msg
          });
          setMode('CONFIRMATION');
        }
        if (input === 'r') {
          setConfirmState({
            action: 'RESET_COMMIT',
            target: activeLine.hash,
            backMode: 'COMMIT_LOG',
            extraData: activeLine.msg
          });
          setMode('CONFIRMATION');
        }
      }

      if (key.escape) {
        setMode('STATUS');
      }
    } else if (mode === 'COMMIT_DIFF') {
      if (key.downArrow && commitDiffLines.length > 0) {
        setCommitDiffScrollIndex((prev) => Math.min(prev + 1, commitDiffLines.length - 1));
      }
      if (key.upArrow && commitDiffLines.length > 0) {
        setCommitDiffScrollIndex((prev) => Math.max(prev - 1, 0));
      }
      if (key.escape || input === 'd' || key.return) {
        setMode('COMMIT_LOG');
      }
    } else if (mode === 'BRANCH_LIST') {
      if (key.downArrow && detailedBranches.length > 0) {
        setSelectedBranchIndex((prev) => Math.min(prev + 1, detailedBranches.length - 1));
      }
      if (key.upArrow && detailedBranches.length > 0) {
        setSelectedBranchIndex((prev) => Math.max(prev - 1, 0));
      }
      
      const activeBranch = detailedBranches[selectedBranchIndex];
      
      if (activeBranch) {
        if (key.return || input === ' ') {
          if (activeBranch.isActive) return;
          try {
            setLoading(true);
            await execa('git', ['checkout', activeBranch.name]);
            setMode('STATUS');
            await refreshStatus();
          } catch (err: any) {
            setError(err.message);
            setLoading(false);
          }
        }
        
        if (input === 'd' || key.delete) {
          if (activeBranch.isActive) {
            setError('Cannot delete the active branch. Checkout to another branch first.');
            return;
          }
          setConfirmState({
            action: 'DELETE_BRANCH',
            target: activeBranch.name,
            backMode: 'BRANCH_LIST'
          });
          setMode('CONFIRMATION');
        }

        if (input === 'm') {
          if (activeBranch.isActive) return;
          setConfirmState({
            action: 'MERGE_BRANCH',
            target: activeBranch.name,
            backMode: 'BRANCH_LIST'
          });
          setMode('CONFIRMATION');
        }
      }

      if (input === 'r') {
        setRenameBranchName(branch);
        setMode('RENAME_BRANCH_INPUT');
      }

      if (input === 'n' || input === 'B') {
        setNewBranchName('');
        setMode('NEW_BRANCH_INPUT');
      }

      if (key.escape) {
        setMode('STATUS');
      }
    } else if (mode === 'CONFIRMATION') {
      if (input === 'y' || input === 'Y') {
        try {
          setLoading(true);
          const { action, target } = confirmState;
          if (action === 'DELETE_BRANCH') {
            await execa('git', ['branch', '-D', target]);
          } else if (action === 'MERGE_BRANCH') {
            await execa('git', ['merge', target]);
          } else if (action === 'RESET_COMMIT') {
            await execa('git', ['reset', target]);
          } else if (action === 'CHECKOUT_COMMIT') {
            await execa('git', ['checkout', target]);
          }
          
          setMode(confirmState.backMode);
          await refreshStatus();
          if (confirmState.backMode === 'BRANCH_LIST') {
            await fetchBranches();
          } else if (confirmState.backMode === 'COMMIT_LOG') {
            await fetchCommits();
          }
        } catch (err: any) {
          setError(err.message);
          setLoading(false);
        }
      } else if (input === 'n' || input === 'N' || key.escape) {
        setMode(confirmState.backMode);
      }
    } else if (key.escape) {
      setMode('STATUS');
    }
  });

  const handleCommitSubmit = async () => {
    if (!commitMsg.trim()) return;
    try {
      setLoading(true);
      await execa('git', ['commit', '-m', commitMsg.trim()]);
      setCommitMsg('');
      setMode('STATUS');
      await refreshStatus();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleNewBranchSubmit = async () => {
    if (!newBranchName.trim()) return;
    try {
      setLoading(true);
      await execa('git', ['checkout', '-b', newBranchName.trim()]);
      setNewBranchName('');
      setMode('STATUS');
      await refreshStatus();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleRenameBranchSubmit = async () => {
    if (!renameBranchName.trim()) return;
    try {
      setLoading(true);
      await execa('git', ['branch', '-m', renameBranchName.trim()]);
      setRenameBranchName('');
      setMode('BRANCH_LIST');
      await fetchBranches();
      await refreshStatus();
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
        <Card title="Error Message" borderColor="red" flexGrow={1}>
          <Box paddingY={1} flexDirection="column" flexGrow={1}>
            <Text color="red">{error}</Text>
            <Box marginTop={2}>
              <Text color="gray">Press 'Esc' to clear this error and return.</Text>
            </Box>
          </Box>
        </Card>
        <Footer keys={[{ key: 'Esc', desc: 'Go back' }, { key: 'q', desc: 'Quit' }]} />
      </Layout>
    );
  }

  if (loading && (mode === 'STATUS' || mode === 'COMMIT_LOG' || mode === 'BRANCH_LIST')) {
    return (
      <Layout>
        <Header title="Git" />
        <Box paddingY={2} alignItems="center" justifyContent="center" flexGrow={1}>
          <Text color="yellow">Loading Git data...</Text>
        </Box>
      </Layout>
    );
  }

  let syncInfo = '';
  if (!hasUpstream) {
    syncInfo = ' | ⚠️ No upstream tracking';
  } else {
    const parts: string[] = [];
    if (ahead && ahead > 0) {
      parts.push(`⇡ ${ahead} ahead`);
    }
    if (behind && behind > 0) {
      parts.push(`⇣ ${behind} behind`);
    }
    if (parts.length > 0) {
      syncInfo = ` | ${parts.join(', ')}`;
    } else {
      syncInfo = ' | ✓ Up to date';
    }
  }

  return (
    <Layout>
      <Header title={`Git [Branch: ${branch}]${syncInfo}`} />

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
              { key: 'Space/s', desc: 'Stage/unstage' },
              { key: 'd', desc: 'View Diff' },
              { key: 'S', desc: 'Stage All' },
              { key: 'U', desc: 'Unstage All' },
              { key: 'c', desc: 'Commit' },
              { key: 'l', desc: 'Log Graph' },
              { key: 'b', desc: 'Branch List' },
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
          <Card title="Interactive Git Commit Graph (Last 50 commits)" borderColor="cyan" flexGrow={1}>
            <ScrollableList 
              items={logLines}
              selectedIndex={selectedCommitIndex}
              renderItem={(item, isSelected) => {
                const colorPrefix = colorizeGraph(item.graphPrefix);
                if (item.isCommit) {
                  return (
                    <Text key={item.hash} wrap="truncate" color={isSelected ? 'cyan' : 'white'}>
                      {isSelected ? '▶ ' : '  '}
                      <Text>{colorPrefix}</Text>
                      <Text color="yellow">{item.hash}</Text>
                      <Text color="gray"> ({item.date})</Text>
                      <Text bold color={isSelected ? 'cyan' : 'white'}> {item.msg}</Text>
                      <Text color="gray" dimColor> @{item.author}</Text>
                    </Text>
                  );
                } else {
                  return (
                    <Text key={Math.random()} color="white">
                      {'  '}
                      <Text>{colorPrefix}</Text>
                    </Text>
                  );
                }
              }}
              maxVisible={maxVisibleList + 2}
            />
          </Card>
          
          <Footer 
            keys={[
              { key: '↑/↓', desc: 'Scroll commits' },
              { key: 'Enter/d', desc: 'Commit Details' },
              { key: 'c', desc: 'Checkout HEAD' },
              { key: 'r', desc: 'Reset Branch' },
              { key: 'Esc', desc: 'Back' }
            ]}
          />
        </>
      )}

      {mode === 'COMMIT_DIFF' && (
        <>
          <Card title={`Commit Details: ${commitDiffHash}`} borderColor="magenta" flexGrow={1}>
            <ScrollableList 
              items={commitDiffLines}
              selectedIndex={commitDiffScrollIndex}
              renderItem={(line) => (
                <Text key={Math.random()} color="white">{line || ' '}</Text>
              )}
              maxVisible={maxVisibleList + 2}
            />
          </Card>
          
          <Footer 
            keys={[
              { key: '↑/↓', desc: 'Scroll diff' },
              { key: 'Esc/Enter', desc: 'Back to Log' }
            ]}
          />
        </>
      )}

      {mode === 'BRANCH_LIST' && (
        <>
          <Card title="Branch Management Workbench" borderColor="cyan" flexGrow={1}>
            {/* Headers row */}
            <Box flexDirection="row" paddingX={2} marginBottom={1} borderStyle="classic" borderColor="gray">
              <Box width="25%"><Text bold color="cyan">Branch Name</Text></Box>
              <Box width="18%"><Text bold color="cyan">Tracking</Text></Box>
              <Box width="17%"><Text bold color="cyan">Relative Age</Text></Box>
              <Box width="40%"><Text bold color="cyan">Latest Commit</Text></Box>
            </Box>

            <ScrollableList 
              items={detailedBranches}
              selectedIndex={selectedBranchIndex}
              renderItem={(item, isSelected) => {
                const isCurrent = item.isActive;
                const nameColor = isCurrent ? 'green' : (item.isRemote ? 'red' : 'white');
                return (
                  <Box key={item.name} flexDirection="row">
                    <Box width="25%">
                      <Text bold={isCurrent} color={isSelected ? 'cyan' : nameColor} wrap="truncate">
                        {isSelected ? '▶ ' : '  '}
                        {isCurrent ? '★ ' : ''}
                        {item.name}
                      </Text>
                    </Box>
                    <Box width="18%">
                      <Text color="gray" wrap="truncate">{item.upstream || 'none'}</Text>
                    </Box>
                    <Box width="17%">
                      <Text color="yellow" wrap="truncate">{item.date}</Text>
                    </Box>
                    <Box width="40%">
                      <Text color={isSelected ? 'cyan' : 'white'} wrap="truncate" dimColor={!isSelected && !isCurrent}>
                        {item.subject}
                      </Text>
                    </Box>
                  </Box>
                );
              }}
              maxVisible={maxVisibleList}
            />
          </Card>
          <Footer 
            keys={[
              { key: '↑/↓', desc: 'Navigate' },
              { key: 'Enter/Space', desc: 'Checkout' },
              { key: 'd/Delete', desc: 'Delete Branch' },
              { key: 'm', desc: 'Merge' },
              { key: 'r', desc: 'Rename Active' },
              { key: 'n', desc: 'New Branch' },
              { key: 'Esc', desc: 'Cancel' }
            ]} 
          />
        </>
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

      {mode === 'RENAME_BRANCH_INPUT' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Rename Active Branch" 
            value={renameBranchName} 
            onChange={setRenameBranchName} 
            onSubmit={handleRenameBranchSubmit}
            placeholder="Enter new branch name..."
          />
          <Footer keys={[{ key: 'Enter', desc: 'Rename' }, { key: 'Esc', desc: 'Cancel' }]} />
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

      {mode === 'CONFIRMATION' && (
        <Box paddingY={1} flexGrow={1} alignItems="center" justifyContent="center">
          <Card 
            title="⚠️ Safety Intercept Panel" 
            borderColor={
              confirmState.action === 'DELETE_BRANCH' || confirmState.action === 'RESET_COMMIT' 
                ? 'red' 
                : 'yellow'
            }
            width={60}
          >
            <Box paddingY={1} flexDirection="column" alignItems="center">
              <Text bold color="white" inverse> WARNING: HIGH-RISK ACTION DETECTED </Text>
              
              <Box marginTop={1} paddingX={1} flexDirection="column" alignItems="center">
                {confirmState.action === 'DELETE_BRANCH' && (
                  <>
                    <Text color="red" bold>Delete branch: "{confirmState.target}"</Text>
                    <Text color="gray">This runs: git branch -D {confirmState.target}</Text>
                    <Text color="gray" dimColor>Any unmerged changes will be permanently discarded.</Text>
                  </>
                )}
                {confirmState.action === 'MERGE_BRANCH' && (
                  <>
                    <Text color="yellow" bold>Merge branch: "{confirmState.target}"</Text>
                    <Text color="gray">This runs: git merge {confirmState.target} into {branch}</Text>
                    <Text color="gray" dimColor>This will merge history and may trigger merge conflicts.</Text>
                  </>
                )}
                {confirmState.action === 'RESET_COMMIT' && (
                  <>
                    <Text color="red" bold>Reset branch to commit: "{confirmState.target}"</Text>
                    <Text color="gray" dimColor>"{confirmState.extraData}"</Text>
                    <Text color="gray">This runs a MIXED reset: git reset {confirmState.target}</Text>
                    <Text color="gray" dimColor>Your staging index is updated but local file changes are preserved.</Text>
                  </>
                )}
                {confirmState.action === 'CHECKOUT_COMMIT' && (
                  <>
                    <Text color="yellow" bold>Checkout historical commit: "{confirmState.target}"</Text>
                    <Text color="gray" dimColor>"{confirmState.extraData}"</Text>
                    <Text color="gray">This runs: git checkout {confirmState.target}</Text>
                    <Text color="gray" dimColor>You will enter a DETACHED HEAD state.</Text>
                  </>
                )}
              </Box>

              <Box marginTop={2} flexDirection="row">
                <Box marginRight={3}>
                  <Text color="green" bold>[Y] Confirm & Execute</Text>
                </Box>
                <Box>
                  <Text color="red" bold>[N/Esc] Cancel</Text>
                </Box>
              </Box>
            </Box>
          </Card>
        </Box>
      )}
    </Layout>
  );
};

export default GitPlugin;
