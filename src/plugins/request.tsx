import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import { execa } from 'execa';
import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import chalk from 'chalk';
import { Header, Layout, Card, ScrollableList, Footer, TextInputField, useTerminalSize, useMouse } from '../components/UI.js';
import { PluginProps } from '../core/types.js';

type Tab = 'COLLECTIONS' | 'EDITOR' | 'RESPONSE';
type EditMode = 'VIEW' | 'EDIT_URL' | 'EDIT_HEADERS' | 'EDIT_BODY' | 'EDIT_SAVE_NAME';

interface SavedRequest {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headersStr: string;
  requestBody: string;
}

const INITIAL_COLLECTIONS: SavedRequest[] = [
  { name: 'JSON Todo Endpoint', method: 'GET', url: 'https://jsonplaceholder.typicode.com/todos/1', headersStr: 'Accept: application/json', requestBody: '' },
  { name: 'JSON Create Post', method: 'POST', url: 'https://jsonplaceholder.typicode.com/posts', headersStr: 'Content-Type: application/json', requestBody: '{\n  "title": "Swiss-Update",\n  "body": "Bruno Upgrade"\n}' },
  { name: 'GitHub Zen API', method: 'GET', url: 'https://api.github.com/zen', headersStr: 'User-Agent: Swiss-API-Workbench', requestBody: '' },
  { name: 'Local API Health', method: 'GET', url: 'http://localhost:3000/api/health', headersStr: 'Accept: application/json', requestBody: '' }
];

const RequestPlugin: React.FC<PluginProps> = ({ suppressQuit }) => {
  const size = useTerminalSize();
  const maxVisibleLines = Math.max(4, size.rows - 12);
  const maxVisibleCollections = Math.max(4, size.rows - 10);

  const [activeTab, setActiveTab] = useState<Tab>('EDITOR');
  const [editMode, setEditMode] = useState<EditMode>('VIEW');

  // Handle global quit suppression when editing inputs
  useEffect(() => {
    if (suppressQuit) {
      suppressQuit(editMode !== 'VIEW');
    }
    return () => {
      if (suppressQuit) suppressQuit(false);
    };
  }, [editMode, suppressQuit]);

  // Request values
  const [url, setUrl] = useState('https://jsonplaceholder.typicode.com/todos/1');
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE'>('GET');
  const [headersStr, setHeadersStr] = useState('Accept: application/json');
  const [requestBody, setRequestBody] = useState('{\n  "name": "Swiss-Update"\n}');
  
  // Collections/History values
  const [collections, setCollections] = useState<SavedRequest[]>(INITIAL_COLLECTIONS);
  const [selectedCollectionIndex, setSelectedCollectionIndex] = useState(0);
  const [saveName, setSaveName] = useState('');

  // Response values
  const [responseLines, setResponseLines] = useState<string[]>(['No response details yet. Press [Enter] to dispatch request.']);
  const [responseScrollIndex, setResponseScrollIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [backendUsed, setBackendUsed] = useState('Node HTTP Fetch');

  // Response metadata
  const [latency, setLatency] = useState<number | null>(null);
  const [responseSize, setResponseSize] = useState<number | null>(null);
  const [statusCode, setStatusCode] = useState<number | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const rawRequestPath = '/Users/portablesheep/repos/RawRequest/rawrequest';

  useMouse((event) => {
    if (editMode !== 'VIEW') return;

    if (event.type === 'left_click') {
      const pct = event.x / size.columns;
      if (pct < 0.3) {
        setActiveTab('COLLECTIONS');
      } else if (pct >= 0.3 && pct < 0.7) {
        setActiveTab('EDITOR');
      } else {
        setActiveTab('RESPONSE');
      }
    } else if (event.type === 'scroll_up') {
      if (activeTab === 'COLLECTIONS') {
        setSelectedCollectionIndex((prev) => Math.max(0, prev - 1));
      } else if (activeTab === 'RESPONSE') {
        setResponseScrollIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (event.type === 'scroll_down') {
      if (activeTab === 'COLLECTIONS') {
        setSelectedCollectionIndex((prev) => Math.min(collections.length - 1, prev + 1));
      } else if (activeTab === 'RESPONSE') {
        setResponseScrollIndex((prev) => Math.min(responseLines.length - 1, prev + 1));
      }
    }
  });

  // Highlight JSON structure with Chalk
  const highlightJson = (json: string): string => {
    try {
      const obj = JSON.parse(json);
      const str = JSON.stringify(obj, null, 2);
      
      return str.replace(
        /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
        (match) => {
          if (/^"/.test(match)) {
            if (/:$/.test(match)) {
              return chalk.cyan(match); // JSON Key
            } else {
              return chalk.yellow(match); // JSON String value
            }
          } else if (/true|false/.test(match)) {
            return chalk.green(match); // Boolean
          } else if (/null/.test(match)) {
            return chalk.red(match); // Null
          } else {
            return chalk.magenta(match); // Number
          }
        }
      );
    } catch {
      return json; // Fallback to raw string
    }
  };

  const sendRequest = async () => {
    setLoading(true);
    setResponseLines(['Connecting and preparing request...']);
    setResponseScrollIndex(0);
    setLatency(null);
    setResponseSize(null);
    setStatusCode(null);
    setStatusText(null);

    // Parse headers string into object
    const headersObj: Record<string, string> = {};
    headersStr.split('\n').filter(Boolean).forEach((line) => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        headersObj[parts[0].trim()] = parts.slice(1).join(':').trim();
      }
    });

    const hasRawRequest = fs.existsSync(rawRequestPath);
    const startTime = Date.now();

    try {
      if (hasRawRequest && method === 'GET' && Object.keys(headersObj).length === 0) {
        setBackendUsed('RawRequest Go Binary');
        const { stdout } = await execa(rawRequestPath, [url]);
        const elapsed = Date.now() - startTime;
        setLatency(elapsed);
        setStatusCode(200);
        setStatusText('OK');
        const formatted = highlightJson(stdout);
        setResponseSize(new TextEncoder().encode(stdout).length);
        setResponseLines(formatted.split('\n'));
      } else {
        setBackendUsed('Node HTTP Fetch');
        const options: any = {
          method,
          headers: {
            'User-Agent': 'Swiss-API-Workbench',
            ...headersObj
          }
        };

        if (method === 'POST' || method === 'PUT') {
          options.body = requestBody;
        }

        const res = await fetch(url, options);
        const text = await res.text();
        const elapsed = Date.now() - startTime;
        setLatency(elapsed);
        setStatusCode(res.status);
        setStatusText(res.statusText);
        setResponseSize(new TextEncoder().encode(text).length);

        const statusLine = `HTTP/1.1 ${res.status} ${res.statusText}`;
        const headersLines = Array.from(res.headers.entries())
          .map(([k, v]) => `${k}: ${v}`);

        // Check if JSON to pretty print
        const contentType = res.headers.get('content-type') || '';
        let formattedBody = text;
        if (contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
          formattedBody = highlightJson(text);
        }

        const compiledResponse = [
          chalk.green(statusLine),
          ...headersLines.map(line => chalk.gray(line)),
          '',
          ...formattedBody.split('\n')
        ];

        setResponseLines(compiledResponse);
      }
    } catch (err: any) {
      setResponseLines([chalk.red(`Error executing request:`), chalk.red(err.message)]);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSelectedCollection = () => {
    const req = collections[selectedCollectionIndex];
    if (req) {
      setUrl(req.url);
      setMethod(req.method);
      setHeadersStr(req.headersStr);
      setRequestBody(req.requestBody);
      setActiveTab('EDITOR');
    }
  };

  const handleSaveRequestSubmit = () => {
    if (!saveName.trim()) return;
    const newReq: SavedRequest = {
      name: saveName.trim(),
      method,
      url,
      headersStr,
      requestBody
    };
    setCollections(prev => [...prev, newReq]);
    setSaveName('');
    setEditMode('VIEW');
  };

  useInput((input, key) => {
    if (editMode !== 'VIEW') {
      if (key.escape) setEditMode('VIEW');
      return;
    }

    // Tab switcher
    if (key.tab) {
      setActiveTab(prev => {
        if (prev === 'COLLECTIONS') return 'EDITOR';
        if (prev === 'EDITOR') return 'RESPONSE';
        return 'COLLECTIONS';
      });
      return;
    }

    if (input === '1') {
      setActiveTab('COLLECTIONS');
      return;
    }
    if (input === '2') {
      setActiveTab('EDITOR');
      return;
    }
    if (input === '3') {
      setActiveTab('RESPONSE');
      return;
    }

    // Input handling based on focused panel
    if (activeTab === 'COLLECTIONS') {
      if (key.downArrow) {
        setSelectedCollectionIndex(prev => Math.min(prev + 1, collections.length - 1));
      }
      if (key.upArrow) {
        setSelectedCollectionIndex(prev => Math.max(prev - 1, 0));
      }
      if (key.return) {
        handleLoadSelectedCollection();
      }
    } else if (activeTab === 'EDITOR') {
      if (key.return) sendRequest();
      if (input === 'e') setEditMode('EDIT_URL');
      if (input === 'h') setEditMode('EDIT_HEADERS');
      if (input === 'b') setEditMode('EDIT_BODY');
      if (input === 's') {
        setSaveName(`Request #${collections.length + 1}`);
        setEditMode('EDIT_SAVE_NAME');
      }
      if (input === 'm') {
        setMethod((prev) => {
          if (prev === 'GET') return 'POST';
          if (prev === 'POST') return 'PUT';
          if (prev === 'PUT') return 'DELETE';
          return 'GET';
        });
      }
    } else if (activeTab === 'RESPONSE') {
      if (key.downArrow) {
        setResponseScrollIndex(prev => Math.min(prev + 1, responseLines.length - 1));
      }
      if (key.upArrow) {
        setResponseScrollIndex(prev => Math.max(prev - 1, 0));
      }
      if (input === 'r') {
        setResponseScrollIndex(0);
      }
    }
  });

  const getMethodColor = (m: string) => {
    switch (m) {
      case 'GET': return 'green';
      case 'POST': return 'cyan';
      case 'PUT': return 'yellow';
      case 'DELETE': return 'red';
      default: return 'white';
    }
  };

  return (
    <Layout>
      <Header title={`API Workbench [Client: ${backendUsed}]`} />

      {editMode === 'EDIT_URL' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Request URL Endpoint" 
            value={url} 
            onChange={setUrl} 
            onSubmit={() => setEditMode('VIEW')}
            placeholder="Enter full request URL..."
          />
          <Footer keys={[{ key: 'Enter', desc: 'Apply URL' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}

      {editMode === 'EDIT_HEADERS' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Request Headers (Key: Value)" 
            value={headersStr} 
            onChange={setHeadersStr} 
            onSubmit={() => setEditMode('VIEW')}
            placeholder="e.g. Content-Type: application/json\nAuthorization: Bearer myToken"
          />
          <Footer keys={[{ key: 'Enter', desc: 'Apply Headers' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}

      {editMode === 'EDIT_BODY' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Request Payload Body" 
            value={requestBody} 
            onChange={setRequestBody} 
            onSubmit={() => setEditMode('VIEW')}
            placeholder="JSON payload string..."
          />
          <Footer keys={[{ key: 'Enter', desc: 'Apply Body' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}

      {editMode === 'EDIT_SAVE_NAME' && (
        <Box flexDirection="column" width="100%">
          <TextInputField 
            label="Save Request As Name" 
            value={saveName} 
            onChange={setSaveName} 
            onSubmit={handleSaveRequestSubmit}
            placeholder="Enter request name..."
          />
          <Footer keys={[{ key: 'Enter', desc: 'Save to Collections' }, { key: 'Esc', desc: 'Cancel' }]} />
        </Box>
      )}

      {editMode === 'VIEW' && (
        <>
          {/* Top Address Bar */}
          <Box flexDirection="row" marginBottom={1}>
            <Box borderStyle="round" borderColor={getMethodColor(method)} paddingX={1} marginRight={1}>
              <Text color={getMethodColor(method)} bold>{method}</Text>
            </Box>
            <Box borderStyle="single" borderColor={activeTab === 'EDITOR' ? 'cyan' : 'gray'} paddingX={1} flexGrow={1}>
              <Text color="white">{url}</Text>
            </Box>
            {statusCode !== null && (
              <Box borderStyle="round" borderColor={statusCode < 300 ? 'green' : 'red'} paddingX={1} marginLeft={1}>
                <Text color={statusCode < 300 ? 'green' : 'red'} bold>
                  {statusCode} {statusText}
                </Text>
              </Box>
            )}
            {latency !== null && (
              <Box borderStyle="round" borderColor="gray" paddingX={1} marginLeft={1}>
                <Text color="yellow" bold>{latency}ms</Text>
              </Box>
            )}
            {responseSize !== null && (
              <Box borderStyle="round" borderColor="gray" paddingX={1} marginLeft={1}>
                <Text color="magenta" bold>{responseSize} B</Text>
              </Box>
            )}
          </Box>

          <Box flexDirection="row" flexGrow={1}>
            {/* Left Panel: Collections */}
            <Box width="28%" marginRight={1}>
              <Card 
                title="[1] Collections" 
                borderColor={activeTab === 'COLLECTIONS' ? 'cyan' : 'gray'} 
                width="100%" 
                flexGrow={1}
              >
                <ScrollableList 
                  items={collections}
                  selectedIndex={activeTab === 'COLLECTIONS' ? selectedCollectionIndex : -1}
                  renderItem={(item, isSelected) => (
                    <Box key={item.name} flexDirection="column" paddingBottom={0}>
                      <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                        {isSelected ? '▶ ' : '  '}{item.name}
                      </Text>
                      <Text color="gray" dimColor>    {item.method} {item.url.slice(0, 18)}...</Text>
                    </Box>
                  )}
                  maxVisible={maxVisibleCollections}
                />
              </Card>
            </Box>

            {/* Middle Panel: Editor */}
            <Box width="35%" flexDirection="column" marginRight={1}>
              <Box flexGrow={1} marginBottom={1}>
                <Card 
                  title="[2] Request Headers" 
                  borderColor={activeTab === 'EDITOR' ? 'cyan' : 'gray'} 
                  width="100%" 
                  flexGrow={1}
                >
                  <Text color="gray" wrap="truncate">{headersStr || '<none>'}</Text>
                </Card>
              </Box>
              {(method === 'POST' || method === 'PUT') && (
                <Box flexGrow={1}>
                  <Card 
                    title="[2] Request Payload" 
                    borderColor={activeTab === 'EDITOR' ? 'cyan' : 'gray'} 
                    width="100%" 
                    flexGrow={1}
                  >
                    <Text color="gray" wrap="wrap">{requestBody || '<none>'}</Text>
                  </Card>
                </Box>
              )}
            </Box>

            {/* Right Panel: Response Pane */}
            <Box width="37%">
              <Card 
                title="[3] HTTP Response" 
                borderColor={activeTab === 'RESPONSE' ? 'cyan' : 'gray'} 
                width="100%" 
                flexGrow={1}
              >
                {loading ? (
                  <Text color="yellow">Sending request...</Text>
                ) : (
                  <ScrollableList 
                    items={responseLines}
                    selectedIndex={activeTab === 'RESPONSE' ? responseScrollIndex : 0}
                    renderItem={(line, isSelected) => (
                      <Text key={Math.random()} color={isSelected && activeTab === 'RESPONSE' ? 'cyan' : 'white'}>{line || ' '}</Text>
                    )}
                    maxVisible={maxVisibleLines}
                  />
                )}
              </Card>
            </Box>
          </Box>

          {/* Navigation Legend Footers */}
          <Footer 
            keys={
              activeTab === 'COLLECTIONS'
                ? [
                    { key: 'Tab', desc: 'Next Panel' },
                    { key: '1/2/3', desc: 'Focus Panel' },
                    { key: '↑/↓', desc: 'Select Saved Request' },
                    { key: 'Enter', desc: 'Load Request' },
                    { key: 'q', desc: 'Quit' }
                  ]
                : activeTab === 'EDITOR'
                ? [
                    { key: 'Tab', desc: 'Next Panel' },
                    { key: '1/2/3', desc: 'Focus Panel' },
                    { key: 'Enter', desc: 'Send API Request' },
                    { key: 'e', desc: 'Edit URL' },
                    { key: 'm', desc: 'Cycle Method' },
                    { key: 'h', desc: 'Edit Headers' },
                    { key: 'b', desc: 'Edit Body' },
                    { key: 's', desc: 'Save request' },
                    { key: 'q', desc: 'Quit' }
                  ]
                : [
                    { key: 'Tab', desc: 'Next Panel' },
                    { key: '1/2/3', desc: 'Focus Panel' },
                    { key: '↑/↓', desc: 'Scroll response' },
                    { key: 'r', desc: 'Reset scroll' },
                    { key: 'q', desc: 'Quit' }
                  ]
            }
          />
        </>
      )}
    </Layout>
  );
};

export default RequestPlugin;
