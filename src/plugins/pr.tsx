import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import fetch from 'node-fetch';
import { execa } from 'execa';
import { Header, Layout, Card, ScrollableList, Footer, StatusBadge, useTerminalSize, TextInputField } from '../components/UI.js';
import { PluginProps } from '../core/types.js';

export const name = 'PR';
export const description = 'GitHub Pull Request monitor';
export const configFields = [
  { key: 'githubToken', label: 'GitHub API Token', description: 'Personal Access Token for PR Monitor' }
];

interface PullRequest {
  id: number;
  title: string;
  author: string;
  status: 'pending' | 'approved' | 'changes_requested';
  ciStatus: 'passing' | 'running' | 'failing';
  url: string;
}

const PRPlugin: React.FC<PluginProps> = ({ config }) => {
  const size = useTerminalSize();
  const [repo, setRepo] = useState('');
  const [mode, setMode] = useState<'VIEW' | 'EDIT_REPO'>('VIEW');
  const [inputRepo, setInputRepo] = useState('');
  const maxVisibleList = Math.max(4, size.rows - (config.githubToken ? 10 : 13));
  const [myPRs, setMyPRs] = useState<PullRequest[]>([]);
  const [teamPRs, setTeamPRs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [gitError, setGitError] = useState<string | null>(null);

  const detectRepo = async () => {
    try {
      // First verify if inside a git repository
      try {
        await execa('git', ['rev-parse', '--is-inside-work-tree']);
      } catch (e) {
        throw new Error('Not a git repository (or any of the parent directories)');
      }

      let stdout;
      try {
        const res = await execa('git', ['config', '--get', 'remote.origin.url']);
        stdout = res.stdout;
      } catch (e) {
        throw new Error('No remote origin URL found');
      }

      const url = stdout.trim();
      const match = url.match(/github\.com[:/]([^/]+\/[^.]+)/);
      if (match && match[1]) {
        return match[1].replace(/\.git$/, '');
      } else {
        throw new Error('No GitHub remote origin found');
      }
    } catch (err: any) {
      setGitError(err.message);
      setLoading(false);
      throw err;
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    const token = config.githubToken;

    if (token) {
      // Live Mode
      try {
        setIsLive(true);
        const headers = {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'Swiss-TUI-PR-Monitor'
        };

        // Get current authenticated user to identify own PRs
        const userRes = await fetch('https://api.github.com/user', { headers });
        if (!userRes.ok) {
          throw new Error(`GitHub Auth failed (${userRes.status}): ${userRes.statusText}`);
        }
        const userData: any = await userRes.json();
        const username = userData.login;

        // Fetch open pull requests
        const pullsRes = await fetch(`https://api.github.com/repos/${repo}/pulls?state=open`, { headers });
        if (!pullsRes.ok) {
          throw new Error(`Fetch PRs failed (${pullsRes.status}): ${pullsRes.statusText}`);
        }
        const pulls: any = await pullsRes.json();

        if (!Array.isArray(pulls)) {
          throw new Error('Unexpected GitHub response format: expected list of pull requests');
        }

        const formatted: PullRequest[] = await Promise.all(pulls.map(async (pr: any) => {
          let ciStatus: PullRequest['ciStatus'] = 'passing';
          try {
            const statusRes = await fetch(`https://api.github.com/repos/${repo}/commits/${pr.head.sha}/status`, { headers });
            if (statusRes.ok) {
              const statusData: any = await statusRes.json();
              if (statusData.state === 'failure' || statusData.state === 'error') {
                ciStatus = 'failing';
              } else if (statusData.state === 'pending') {
                ciStatus = 'running';
              }
            }
          } catch {}

          let reviewStatus: PullRequest['status'] = 'pending';
          try {
            const reviewsRes = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr.number}/reviews`, { headers });
            if (reviewsRes.ok) {
              const reviews: any = await reviewsRes.json();
              const states = reviews.map((r: any) => r.state);
              if (states.includes('CHANGES_REQUESTED')) {
                reviewStatus = 'changes_requested';
              } else if (states.includes('APPROVED')) {
                reviewStatus = 'approved';
              }
            }
          } catch {}

          return {
            id: pr.number,
            title: pr.title,
            author: pr.user.login,
            status: reviewStatus,
            ciStatus: ciStatus,
            url: pr.html_url
          };
        }));

        const mine = formatted.filter(p => p.author === username);
        const team = formatted.filter(p => p.author !== username);
        setMyPRs(mine);
        setTeamPRs(team);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    } else {
      // Mock Mode Fallback
      setIsLive(false);
      setTimeout(() => {
        setMyPRs([
          { 
            id: 123, 
            title: 'feat: Add plugin auto-discovery CLI config', 
            author: 'me', 
            status: 'approved', 
            ciStatus: 'passing',
            url: 'https://github.com/portablesheep/swiss/pull/123'
          }
        ]);
        setTeamPRs([
          { 
            id: 124, 
            title: 'refactor: Rewrite PluginLoader to use ES modules', 
            author: 'teammate_a', 
            status: 'pending', 
            ciStatus: 'passing',
            url: 'https://github.com/portablesheep/swiss/pull/124'
          },
          { 
            id: 125, 
            title: 'fix: Resolve socket leaks during long TUI sessions', 
            author: 'teammate_b', 
            status: 'changes_requested', 
            ciStatus: 'failing',
            url: 'https://github.com/portablesheep/swiss/pull/125'
          },
          { 
            id: 126, 
            title: 'chore: Setup custom integration metrics pipeline', 
            author: 'teammate_c', 
            status: 'pending', 
            ciStatus: 'running',
            url: 'https://github.com/portablesheep/swiss/pull/126'
          }
        ]);
        setLoading(false);
      }, 800);
    }
  };

  useEffect(() => {
    const init = async () => {
      try {
        const detected = await detectRepo();
        setRepo(detected);
      } catch (e) {
        // Handled via gitError state inside detectRepo
      }
    };
    init();
  }, [config]);

  useEffect(() => {
    if (repo && !gitError) {
      fetchData();
    }
  }, [repo, gitError]);

  const allPRs = [...teamPRs, ...myPRs];

  useInput(async (input, key) => {
    if (loading) return;

    if (mode === 'VIEW') {
      if (key.downArrow && allPRs.length > 0) {
        setSelectedIndex((prev) => Math.min(prev + 1, allPRs.length - 1));
      }
      if (key.upArrow && allPRs.length > 0) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      }
      if (input === 'r') {
        fetchData();
      }
      if (input === 'o') {
        const selectedPR = allPRs[selectedIndex];
        if (selectedPR) {
          try {
            await execa('open', [selectedPR.url]);
          } catch {}
        }
      }
      if (input === 's') {
        setInputRepo(repo);
        setMode('EDIT_REPO');
      }
    } else {
      if (key.escape) {
        setMode('VIEW');
      }
    }
  });

  if (gitError) {
    return (
      <Layout>
        <Header title="PR Monitor" />
        <Card title="Fatal Error" borderColor="red" flexGrow={1}>
          <Box paddingY={1} flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
            <StatusBadge status="Error" />
            <Box marginTop={1}>
              <Text color="red" bold>Fatal: {gitError}</Text>
            </Box>
            <Box marginTop={1}>
              <Text color="gray">The PR Monitor requires an active Git repository with a configured GitHub remote origin.</Text>
            </Box>
          </Box>
        </Card>
        <Footer keys={[{ key: 'q', desc: 'Quit' }]} />
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout>
        <Header title="PR Monitor" />
        <Text color="yellow">Fetching pull requests...</Text>
      </Layout>
    );
  }

  const renderPRLine = (pr: PullRequest, index: number, offset: number) => {
    const actualIndex = index + offset;
    const isSelected = actualIndex === selectedIndex;
    
    return (
      <Box key={pr.id} flexDirection="row" justifyContent="space-between" paddingX={1} backgroundColor={isSelected ? 'blue' : undefined}>
        <Box flexGrow={1}>
          <Text color={isSelected ? 'white' : 'white'} bold={isSelected}>
            {isSelected ? '▶ ' : '  '}#{pr.id}: {pr.title}
          </Text>
          <Text color={isSelected ? 'cyan' : 'gray'}> @{pr.author}</Text>
        </Box>
        <Box>
          <StatusBadge status={pr.ciStatus} />
          <Text color="gray"> | </Text>
          <StatusBadge status={pr.status} />
        </Box>
      </Box>
    );
  };

  return (
    <Layout>
      <Header title={`PR Monitor [${isLive ? 'LIVE' : 'MOCK'}][Repo: ${repo}]`} />
      
      {mode === 'EDIT_REPO' ? (
        <Box flexDirection="column" width="100%">
          <TextInputField
            label="Swap Repository (owner/repo)"
            value={inputRepo}
            onChange={setInputRepo}
            onSubmit={(val) => {
              if (val.trim()) {
                setRepo(val.trim());
              }
              setMode('VIEW');
            }}
            placeholder="e.g. facebook/react"
          />
          <Footer keys={[{ key: 'Enter', desc: 'Apply Repository' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      ) : (
        <>
          {!isLive && (
            <Box marginBottom={1} paddingX={1} borderStyle="classic" borderColor="yellow">
              <Text color="yellow" bold>💡 Running in offline mock mode. Set "pr.githubToken" via "swiss config" to connect live!</Text>
            </Box>
          )}

          {error && (
            <Box marginBottom={1} paddingX={1} borderStyle="single" borderColor="red">
              <Text color="red">Error: {error}</Text>
            </Box>
          )}

          <Box flexDirection="row" flexGrow={1}>
            {/* Pending Review Section */}
            <Box width="50%" marginRight={1}>
              <Card title={`Pending Review (${teamPRs.length})`} borderColor="yellow" width="100%">
                <ScrollableList 
                  items={teamPRs}
                  selectedIndex={selectedIndex < teamPRs.length ? selectedIndex : -1}
                  renderItem={(pr, isSelected) => renderPRLine(pr, teamPRs.indexOf(pr), 0)}
                  maxVisible={maxVisibleList}
                />
              </Card>
            </Box>

            {/* Your Pull Requests Section */}
            <Box width="50%">
              <Card title={`Your PRs (${myPRs.length})`} borderColor="green" width="100%">
                <ScrollableList 
                  items={myPRs}
                  selectedIndex={selectedIndex >= teamPRs.length ? selectedIndex - teamPRs.length : -1}
                  renderItem={(pr, isSelected) => renderPRLine(pr, myPRs.indexOf(pr), teamPRs.length)}
                  maxVisible={maxVisibleList}
                />
              </Card>
            </Box>
          </Box>

          <Footer 
            keys={[
              { key: '↑/↓', desc: 'Navigate PRs' },
              { key: 'o', desc: 'Open PR' },
              { key: 's', desc: 'Swap Repo' },
              { key: 'r', desc: 'Refresh' },
              { key: 'q', desc: 'Quit' }
            ]}
          />
        </>
      )}
    </Layout>
  );
};

export default PRPlugin;
