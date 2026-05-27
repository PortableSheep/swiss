import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import fetch from 'node-fetch';
import { execa } from 'execa';
import { Header, Layout, Card, ScrollableList, Footer, StatusBadge, useTerminalSize } from '../components/UI.js';
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
  repoName?: string;
}

const PRPlugin: React.FC<PluginProps> = ({ config }) => {
  const size = useTerminalSize();
  const maxVisibleList = Math.max(4, size.rows - (config.githubToken ? 10 : 13));
  const [myPRs, setMyPRs] = useState<PullRequest[]>([]);
  const [teamPRs, setTeamPRs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

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

        // Fetch open pull requests created by the user across all of GitHub
        const mineRes = await fetch(`https://api.github.com/search/issues?q=is:open+is:pr+author:${username}`, { headers });
        if (!mineRes.ok) {
          throw new Error(`Fetch My PRs failed (${mineRes.status}): ${mineRes.statusText}`);
        }
        const mineData: any = await mineRes.json();
        const minePulls = (mineData.items || []).slice(0, 15);

        // Fetch open pull requests requesting the user's review across all of GitHub
        const teamRes = await fetch(`https://api.github.com/search/issues?q=is:open+is:pr+review-requested:${username}`, { headers });
        if (!teamRes.ok) {
          throw new Error(`Fetch Team PRs failed (${teamRes.status}): ${teamRes.statusText}`);
        }
        const teamData: any = await teamRes.json();
        const teamPulls = (teamData.items || []).slice(0, 15);

        const formatPRList = async (pulls: any[]) => {
          return await Promise.all(pulls.map(async (pr: any) => {
            let ciStatus: PullRequest['ciStatus'] = 'passing';
            let reviewStatus: PullRequest['status'] = 'pending';
            
            // Extract repo owner/name from repository_url
            const match = pr.repository_url.match(/api\.github\.com\/repos\/([^/]+\/[^/]+)/);
            const repoName = match ? match[1] : '';

            if (repoName) {
              try {
                // Fetch PR detail to get head.sha
                const detailRes = await fetch(`https://api.github.com/repos/${repoName}/pulls/${pr.number}`, { headers });
                if (detailRes.ok) {
                  const prDetail: any = await detailRes.json();
                  const headSha = prDetail.head?.sha;
                  
                  if (headSha) {
                    const statusRes = await fetch(`https://api.github.com/repos/${repoName}/commits/${headSha}/status`, { headers });
                    if (statusRes.ok) {
                      const statusData: any = await statusRes.json();
                      if (statusData.state === 'failure' || statusData.state === 'error') {
                        ciStatus = 'failing';
                      } else if (statusData.state === 'pending') {
                        ciStatus = 'running';
                      }
                    }
                  }
                }
              } catch {}

              try {
                const reviewsRes = await fetch(`https://api.github.com/repos/${repoName}/pulls/${pr.number}/reviews`, { headers });
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
            }

            return {
              id: pr.number,
              title: pr.title,
              author: pr.user.login,
              status: reviewStatus,
              ciStatus: ciStatus,
              url: pr.html_url,
              repoName: repoName
            };
          }));
        };

        const formattedMine = await formatPRList(minePulls);
        const formattedTeam = await formatPRList(teamPulls);

        setMyPRs(formattedMine);
        setTeamPRs(formattedTeam);
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
            url: 'https://github.com/portablesheep/swiss/pull/123',
            repoName: 'portablesheep/swiss'
          }
        ]);
        setTeamPRs([
          { 
            id: 124, 
            title: 'refactor: Rewrite PluginLoader to use ES modules', 
            author: 'teammate_a', 
            status: 'pending', 
            ciStatus: 'passing',
            url: 'https://github.com/portablesheep/swiss/pull/124',
            repoName: 'portablesheep/swiss'
          },
          { 
            id: 125, 
            title: 'fix: Resolve socket leaks during long TUI sessions', 
            author: 'teammate_b', 
            status: 'changes_requested', 
            ciStatus: 'failing',
            url: 'https://github.com/portablesheep/swiss/pull/125',
            repoName: 'portablesheep/swiss'
          },
          { 
            id: 126, 
            title: 'chore: Setup custom integration metrics pipeline', 
            author: 'teammate_c', 
            status: 'pending', 
            ciStatus: 'running',
            url: 'https://github.com/portablesheep/swiss/pull/126',
            repoName: 'portablesheep/swiss'
          }
        ]);
        setLoading(false);
      }, 800);
    }
  };

  useEffect(() => {
    fetchData();
  }, [config]);

  const allPRs = [...teamPRs, ...myPRs];

  useInput(async (input, key) => {
    if (loading) return;

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
  });

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
            {isSelected ? '▶ ' : '  '}{pr.repoName ? `[${pr.repoName}] ` : ''}#{pr.id}: {pr.title}
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
      <Header title={`PR Monitor [${isLive ? 'LIVE' : 'MOCK'}]`} />
      
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
          { key: 'r', desc: 'Refresh' },
          { key: 'q', desc: 'Quit' }
        ]}
      />
    </Layout>
  );
};

export default PRPlugin;
