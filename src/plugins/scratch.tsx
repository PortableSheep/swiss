import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import TextInput from 'ink-text-input';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Header, Layout, Card, ScrollableList, Footer, TextInputField, useTerminalSize, useMouse } from '../components/UI.js';
import { PluginProps } from '../core/types.js';

export const name = 'Scratch';
export const description = 'Multi-file persistent developer gist scratchpad';

type Mode = 'VIEW' | 'EDIT' | 'NEW_FILE' | 'RENAME_FILE';
type FocusedPane = 'SIDEBAR' | 'EDITOR';

const getStorePath = () => {
  return path.join(os.homedir(), '.swiss_scratch_gists.json');
};

const defaultContent = `{
  "scratchpad.txt": "Welcome to your Swiss Gist Workbench!\\n\\nPress 'e' to edit this file.\\nPress 'n' to create a new scratch/gist file.\\nPress 'r' to rename the current file.\\nPress 'd' or 'Delete' to delete it.\\nPress 'Tab' or arrows to switch between sidebar and editor.\\n\\nEnjoy using Swiss!",
  "todo.md": "- [ ] Implement dynamic auto-discovery\\n- [x] Build Bruno HTTP client\\n- [ ] Clean up standard workspace files"
}`;

const loadStoreFromDisk = (): Record<string, string> => {
  const filePath = getStorePath();
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return JSON.parse(defaultContent);
    }
  }
  // Initialize with default content
  try {
    fs.writeFileSync(filePath, defaultContent, 'utf-8');
  } catch {}
  return JSON.parse(defaultContent);
};

const saveStoreToDisk = (store: Record<string, string>) => {
  const filePath = getStorePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  } catch {}
};

const ScratchPlugin: React.FC<PluginProps> = ({ suppressQuit }) => {
  const size = useTerminalSize();
  const [store, setStore] = useState<Record<string, string>>({});
  const [fileList, setFileList] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  
  // Interactive UI states
  const [focusedPane, setFocusedPane] = useState<FocusedPane>('SIDEBAR');
  const [mode, setMode] = useState<Mode>('VIEW');
  const [editorContent, setEditorContent] = useState('');
  const [inputText, setInputText] = useState('');
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  
  // View scroll state for long files
  const [editorScrollIndex, setEditorScrollIndex] = useState(0);
  const [statusMsg, setStatusMsg] = useState('');

  // Handle store initialization
  useEffect(() => {
    const loadedStore = loadStoreFromDisk();
    setStore(loadedStore);
    const keys = Object.keys(loadedStore);
    setFileList(keys);
    if (keys.length > 0) {
      setSelectedFile(keys[0]);
      setEditorContent(loadedStore[keys[0]] || '');
    }
  }, []);

  // Sync selected index when selectedFile changes
  useEffect(() => {
    const idx = fileList.indexOf(selectedFile);
    if (idx !== -1) {
      setSelectedFileIndex(idx);
    }
    setEditorScrollIndex(0);
    setStatusMsg('');
  }, [selectedFile, fileList]);

  // Handle global quit suppression during active text input/editing
  useEffect(() => {
    if (suppressQuit) {
      suppressQuit(mode !== 'VIEW');
    }
    return () => {
      if (suppressQuit) suppressQuit(false);
    };
  }, [mode, suppressQuit]);

  // Dynamic layout calculations
  const maxVisibleFiles = Math.max(5, size.rows - 10);
  const maxEditorRows = Math.max(5, size.rows - 9);

  // File management CRUD helpers
  const handleCreateFile = () => {
    const nameStr = inputText.trim();
    if (!nameStr) {
      setMode('VIEW');
      return;
    }
    const finalName = nameStr.includes('.') ? nameStr : `${nameStr}.txt`;
    const updatedStore = {
      ...store,
      [finalName]: `# ${finalName}\n\nStart typing here...`
    };
    setStore(updatedStore);
    saveStoreToDisk(updatedStore);
    
    const newKeys = Object.keys(updatedStore);
    setFileList(newKeys);
    setSelectedFile(finalName);
    setEditorContent(updatedStore[finalName]);
    setMode('VIEW');
    setInputText('');
    setStatusMsg(`Created file: ${finalName}`);
  };

  const handleRenameFile = () => {
    const nameStr = inputText.trim();
    if (!nameStr || !selectedFile) {
      setMode('VIEW');
      return;
    }
    const finalName = nameStr.includes('.') ? nameStr : `${nameStr}.txt`;
    if (finalName === selectedFile) {
      setMode('VIEW');
      return;
    }

    const { [selectedFile]: content, ...rest } = store;
    const updatedStore = {
      ...rest,
      [finalName]: content
    };
    setStore(updatedStore);
    saveStoreToDisk(updatedStore);

    const newKeys = Object.keys(updatedStore);
    setFileList(newKeys);
    setSelectedFile(finalName);
    setMode('VIEW');
    setInputText('');
    setStatusMsg(`Renamed file to: ${finalName}`);
  };

  const handleDeleteFile = () => {
    if (!selectedFile) return;
    if (fileList.length <= 1) {
      setStatusMsg('Cannot delete the last file. Add a new file first.');
      return;
    }

    const { [selectedFile]: _, ...updatedStore } = store;
    setStore(updatedStore);
    saveStoreToDisk(updatedStore);

    const newKeys = Object.keys(updatedStore);
    setFileList(newKeys);
    const nextSelected = newKeys[Math.max(0, selectedFileIndex - 1)];
    setSelectedFile(nextSelected);
    setEditorContent(updatedStore[nextSelected] || '');
    setStatusMsg(`Deleted file: ${selectedFile}`);
  };

  const handleSaveEditorContent = () => {
    if (!selectedFile) return;
    const updatedStore = {
      ...store,
      [selectedFile]: editorContent
    };
    setStore(updatedStore);
    saveStoreToDisk(updatedStore);
    setMode('VIEW');
    setStatusMsg(`Saved content in: ${selectedFile}`);
  };

  // Mouse interactivity support
  useMouse((event) => {
    if (mode !== 'VIEW') return;

    const isLeftPane = event.x < Math.floor(size.columns * 0.32);

    if (event.type === 'left_click') {
      if (isLeftPane) {
        setFocusedPane('SIDEBAR');
        const offsetY = 6;
        let start = 0;
        if (selectedFileIndex >= maxVisibleFiles) {
          start = selectedFileIndex - Math.floor(maxVisibleFiles / 2);
          if (start + maxVisibleFiles > fileList.length) {
            start = fileList.length - maxVisibleFiles;
          }
        }
        start = Math.max(0, start);
        const clickedIdx = start + (event.y - offsetY);
        if (clickedIdx >= 0 && clickedIdx < fileList.length && event.y >= offsetY && event.y < offsetY + Math.min(fileList.length, maxVisibleFiles)) {
          setSelectedFile(fileList[clickedIdx]);
          setEditorContent(store[fileList[clickedIdx]] || '');
        }
      } else {
        setFocusedPane('EDITOR');
      }
    } else if (event.type === 'scroll_up') {
      if (isLeftPane) {
        setSelectedFileIndex((prev) => {
          const next = Math.max(0, prev - 1);
          if (fileList[next]) {
            setSelectedFile(fileList[next]);
            setEditorContent(store[fileList[next]] || '');
          }
          return next;
        });
      } else {
        setEditorScrollIndex((prev) => Math.max(0, prev - 1));
      }
    } else if (event.type === 'scroll_down') {
      if (isLeftPane) {
        setSelectedFileIndex((prev) => {
          const next = Math.min(fileList.length - 1, prev + 1);
          if (fileList[next]) {
            setSelectedFile(fileList[next]);
            setEditorContent(store[fileList[next]] || '');
          }
          return next;
        });
      } else {
        const lines = editorContent.split('\n');
        setEditorScrollIndex((prev) => Math.min(lines.length - 1, prev + 1));
      }
    }
  });

  // Keyboard navigation & operations hook
  useInput((input, key) => {
    if (mode === 'EDIT') {
      if (key.escape) {
        setEditorContent(store[selectedFile] || '');
        setMode('VIEW');
      }
      return;
    }

    if (mode === 'NEW_FILE' || mode === 'RENAME_FILE') {
      if (key.escape) {
        setMode('VIEW');
        setInputText('');
      }
      return;
    }

    if (mode === 'VIEW') {
      // Focus pane swapping
      if (key.tab || key.leftArrow || key.rightArrow) {
        setFocusedPane((prev) => (prev === 'SIDEBAR' ? 'EDITOR' : 'SIDEBAR'));
        return;
      }

      // Sidebar pane keyboard navigation
      if (focusedPane === 'SIDEBAR') {
        if (key.downArrow && fileList.length > 0) {
          const nextIdx = Math.min(selectedFileIndex + 1, fileList.length - 1);
          setSelectedFile(fileList[nextIdx]);
          setEditorContent(store[fileList[nextIdx]] || '');
        }
        if (key.upArrow && fileList.length > 0) {
          const nextIdx = Math.max(selectedFileIndex - 1, 0);
          setSelectedFile(fileList[nextIdx]);
          setEditorContent(store[fileList[nextIdx]] || '');
        }
        if (input === 'n') {
          setInputText('');
          setMode('NEW_FILE');
        }
        if (input === 'r' && selectedFile) {
          setInputText(selectedFile);
          setMode('RENAME_FILE');
        }
        if (input === 'd' || key.delete) {
          handleDeleteFile();
        }
      }

      // Editor pane keyboard scrolling
      if (focusedPane === 'EDITOR' && selectedFile) {
        const lines = editorContent.split('\n');
        if (key.downArrow) {
          setEditorScrollIndex((prev) => Math.min(prev + 1, lines.length - 1));
        }
        if (key.upArrow) {
          setEditorScrollIndex((prev) => Math.max(prev - 1, 0));
        }
      }

      // Edit triggers
      if (input === 'e' && selectedFile) {
        setMode('EDIT');
      }
    }
  });

  // Get indicator for focused file item
  const getIndicator = (isSelected: boolean) => {
    if (!isSelected) return '  ';
    return focusedPane === 'SIDEBAR' ? '▶ ' : '▷ ';
  };

  const lines = editorContent.split('\n');
  const visibleContentLines = lines.slice(editorScrollIndex, editorScrollIndex + maxEditorRows);

  return (
    <Layout>
      <Header title="Gist Workbench" />

      {statusMsg && (
        <Box marginBottom={1} paddingX={1} borderStyle="classic" borderColor="green">
          <Text color="green" bold>{statusMsg}</Text>
        </Box>
      )}

      <Box flexDirection="row" flexGrow={1}>
        {/* Left Pane: Gist Files Sidebar */}
        <Box width="30%" marginRight={1}>
          <Card 
            title="Gist Files" 
            borderColor={focusedPane === 'SIDEBAR' ? 'cyan' : 'gray'} 
            width="100%"
          >
            <ScrollableList 
              items={fileList}
              selectedIndex={selectedFileIndex}
              renderItem={(file, isSelected) => (
                <Box key={file} flexDirection="row">
                  <Text color={isSelected ? (focusedPane === 'SIDEBAR' ? 'cyan' : 'white') : 'white'} bold={isSelected}>
                    {getIndicator(isSelected)}{file}
                  </Text>
                </Box>
              )}
              maxVisible={maxVisibleFiles}
            />
          </Card>
        </Box>

        {/* Right Pane: Gist Editor / Content Viewer */}
        <Box width="70%">
          <Card 
            title={selectedFile ? `File: ${selectedFile}` : 'Content Viewer'} 
            borderColor={focusedPane === 'EDITOR' ? 'blue' : 'gray'} 
            width="100%"
          >
            {selectedFile ? (
              <Box flexDirection="column" height="100%" flexGrow={1}>
                {mode === 'EDIT' ? (
                  <Box flexDirection="column" flexGrow={1}>
                    <Text color="gray">--- EDIT MODE (Press Enter to save, Esc to cancel) ---</Text>
                    <Box marginY={1}>
                      <TextInput 
                        value={editorContent} 
                        onChange={setEditorContent} 
                        onSubmit={handleSaveEditorContent} 
                      />
                    </Box>
                  </Box>
                ) : (
                  <Box flexDirection="column" flexGrow={1}>
                    {visibleContentLines.map((line, i) => (
                      <Text key={i}>{line || ' '}</Text>
                    ))}
                    {editorContent === '' && <Text color="gray">Empty file. Press 'e' to write contents...</Text>}
                    {lines.length > maxEditorRows && (
                      <Box marginTop={1}>
                        <Text color="gray" dimColor>
                          -- ({editorScrollIndex + 1}-{Math.min(editorScrollIndex + maxEditorRows, lines.length)}/{lines.length}) [Scroll for more] --
                        </Text>
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            ) : (
              <Text color="gray">No files available. Press 'n' to create one!</Text>
            )}
          </Card>
        </Box>
      </Box>

      {/* Inline Text Fields for New / Rename Operations */}
      {mode === 'NEW_FILE' && (
        <Box marginTop={1}>
          <TextInputField
            label="Create New Gist File"
            value={inputText}
            onChange={setInputText}
            onSubmit={handleCreateFile}
            placeholder="Type filename (e.g. scripts.py) and press Enter..."
            showFocusBorder={true}
          />
        </Box>
      )}

      {mode === 'RENAME_FILE' && (
        <Box marginTop={1}>
          <TextInputField
            label={`Rename: ${selectedFile}`}
            value={inputText}
            onChange={setInputText}
            onSubmit={handleRenameFile}
            placeholder="Type new filename and press Enter..."
            showFocusBorder={true}
          />
        </Box>
      )}

      {/* FOOTER SHORTCUT LEGENDS */}
      {mode === 'VIEW' && (
        <Footer 
          keys={[
            { key: 'Tab/←/→', desc: 'Switch Pane' },
            { key: '↑/↓', desc: focusedPane === 'SIDEBAR' ? 'Select File' : 'Scroll Content' },
            focusedPane === 'SIDEBAR' ? { key: 'n', desc: 'New Gist' } : { key: '', desc: '' },
            focusedPane === 'SIDEBAR' ? { key: 'r', desc: 'Rename' } : { key: '', desc: '' },
            focusedPane === 'SIDEBAR' ? { key: 'd/Del', desc: 'Delete' } : { key: '', desc: '' },
            { key: 'e', desc: 'Edit Content' },
            { key: 'q', desc: 'Quit' }
          ].filter(k => k.key)}
        />
      )}

      {mode === 'EDIT' && (
        <Footer 
          keys={[
            { key: 'Enter', desc: 'Save File' },
            { key: 'Esc', desc: 'Cancel' }
          ]}
        />
      )}

      {(mode === 'NEW_FILE' || mode === 'RENAME_FILE') && (
        <Footer 
          keys={[
            { key: 'Enter', desc: 'Apply Name' },
            { key: 'Esc', desc: 'Cancel' }
          ]}
        />
      )}
    </Layout>
  );
};

export default ScratchPlugin;
