import React, { useState, useEffect, createContext, useContext } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export const HeaderVisibilityContext = createContext<{
  visible: boolean;
  setVisible: (visible: boolean) => void;
}>({
  visible: true,
  setVisible: () => {},
});

export const useHeaderVisibility = () => useContext(HeaderVisibilityContext);

export const HeaderVisibilityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [visible, setVisible] = useState(true);

  useInput((input, key) => {
    if (key.ctrl && input === 'h') {
      setVisible(v => !v);
    }
  });

  return (
    <HeaderVisibilityContext.Provider value={{ visible, setVisible }}>
      {children}
    </HeaderVisibilityContext.Provider>
  );
};

export const useTerminalSize = () => {
  const [size, setSize] = useState({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setSize({
        columns: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      });
    };
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  return size;
};

export const Header: React.FC<{ title: string }> = ({ title }) => {
  const { visible } = useContext(HeaderVisibilityContext);
  if (!visible) return null;

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text bold color="white">
        SWISS 🛠️ <Text color="cyan">{title.toUpperCase()}</Text>
      </Text>
    </Box>
  );
};

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const size = useTerminalSize();
  const height = Math.max(15, size.rows - 2);
  const width = Math.max(40, size.columns - 2);

  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1} paddingY={0}>
      {children}
    </Box>
  );
};

export const Card: React.FC<{
  title: string;
  borderColor?: string;
  borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'singleDouble' | 'classic';
  children: React.ReactNode;
  width?: string | number;
  height?: string | number;
  marginRight?: number;
  marginLeft?: number;
  marginTop?: number;
  marginBottom?: number;
  flexDirection?: 'row' | 'column';
  paddingX?: number;
  paddingY?: number;
  flexGrow?: number;
}> = ({
  title,
  borderColor = 'gray',
  borderStyle = 'single',
  children,
  width,
  height,
  marginRight,
  marginLeft,
  marginTop,
  marginBottom,
  flexDirection = 'column',
  paddingX = 1,
  paddingY = 0,
  flexGrow
}) => (
  <Box
    borderStyle={borderStyle}
    borderColor={borderColor}
    width={width}
    height={height}
    marginRight={marginRight}
    marginLeft={marginLeft}
    marginTop={marginTop}
    marginBottom={marginBottom}
    flexDirection="column"
    flexGrow={flexGrow}
  >
    <Box marginTop={-1} marginLeft={1} paddingX={1} backgroundColor="black">
      <Text bold color={borderColor === 'gray' ? 'white' : borderColor}> {title} </Text>
    </Box>
    <Box flexDirection={flexDirection} paddingX={paddingX} paddingY={paddingY} flexGrow={1}>
      {children}
    </Box>
  </Box>
);

export const ScrollableList: React.FC<{
  items: any[];
  selectedIndex: number;
  renderItem?: (item: any, isSelected: boolean) => React.ReactNode;
  maxVisible?: number;
}> = ({ items, selectedIndex, renderItem, maxVisible = 10 }) => {
  if (items.length === 0) {
    return <Text color="gray">No items found</Text>;
  }

  let start = 0;
  if (selectedIndex >= maxVisible) {
    start = selectedIndex - Math.floor(maxVisible / 2);
    if (start + maxVisible > items.length) {
      start = items.length - maxVisible;
    }
  }
  start = Math.max(0, start);
  const visibleItems = items.slice(start, start + maxVisible);

  return (
    <Box flexDirection="column">
      {visibleItems.map((item, index) => {
        const actualIndex = start + index;
        const isSelected = actualIndex === selectedIndex;
        if (renderItem) {
          return renderItem(item, isSelected);
        }
        return (
          <Text key={actualIndex} color={isSelected ? 'cyan' : 'white'}>
            {isSelected ? '▶ ' : '  '}
            {typeof item === 'string' ? item : item.label || item.value || JSON.stringify(item)}
          </Text>
        );
      })}
      {items.length > maxVisible && (
        <Text color="gray" dimColor>
          -- ({selectedIndex + 1}/{items.length}) [Scroll for more] --
        </Text>
      )}
    </Box>
  );
};

export const Footer: React.FC<{ keys: { key: string; desc: string }[] }> = ({ keys }) => {
  const allKeys = [...keys, { key: 'Ctrl+H', desc: 'Toggle Header' }];
  return (
    <Box marginTop={1} flexDirection="row" flexWrap="wrap">
      {allKeys.map((k, i) => (
        <Box key={i} marginRight={2}>
          <Text color="gray">
            [<Text color="white" bold>{k.key}</Text>] {k.desc}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

export const StatusBadge: React.FC<{ status: string; type?: 'success' | 'warning' | 'error' | 'info' }> = ({ status, type }) => {
  let color = 'white';
  let symbol = '●';
  const val = status.toLowerCase();
  
  if (type === 'success' || val === 'approved' || val === 'passing' || val === 'available' || val === 'done' || val === 'active' || val === 'clean') {
    color = 'green';
    symbol = '✓';
  } else if (type === 'warning' || val === 'pending' || val === 'running' || val === 'dnd' || val === 'in progress' || val === 'warn') {
    color = 'yellow';
    symbol = '○';
  } else if (type === 'error' || val === 'changes_requested' || val === 'failing' || val === 'busy' || val === 'error' || val === 'failed') {
    color = 'red';
    symbol = '✖';
  } else if (type === 'info' || val === 'todo' || val === 'info' || val === 'untracked') {
    color = 'cyan';
    symbol = 'ℹ';
  }

  return (
    <Text color={color} bold>
      {symbol} {status.toUpperCase()}
    </Text>
  );
};

export const TextInputField: React.FC<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  showFocusBorder?: boolean;
}> = ({ label, value, onChange, onSubmit, placeholder, showFocusBorder = true }) => (
  <Box flexDirection="column" borderStyle="single" borderColor={showFocusBorder ? 'cyan' : 'gray'} paddingX={1} paddingY={0}>
    <Box marginTop={-1} marginLeft={1} paddingX={1} backgroundColor="black">
      <Text bold color={showFocusBorder ? 'cyan' : 'white'}> {label} </Text>
    </Box>
    <Box paddingY={1}>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} placeholder={placeholder} />
    </Box>
  </Box>
);

export interface MouseEvent {
  x: number;
  y: number;
  type: 'left_click' | 'right_click' | 'middle_click' | 'scroll_up' | 'scroll_down' | 'release';
}

export const useMouse = (onMouseEvent: (event: MouseEvent) => void) => {
  useEffect(() => {
    // Enable mouse reporting in standard output
    // 1000h: Send mouse clicks and releases
    // 1006h: Enable modern SGR extended coordinate format (avoids coordinate overflow at >95 cols/rows)
    process.stdout.write('\x1b[?1000h');
    process.stdout.write('\x1b[?1006h');
    
    const handleData = (data: Buffer) => {
      const str = data.toString();
      // Match SGR mouse event format: ESC[<button;x;y;M or m
      const match = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (match) {
        const button = parseInt(match[1], 10);
        const x = parseInt(match[2], 10);
        const y = parseInt(match[3], 10);
        const isRelease = match[4] === 'm';
        
        let type: MouseEvent['type'] | null = null;
        if (button === 64) {
          type = 'scroll_up';
        } else if (button === 65) {
          type = 'scroll_down';
        } else if (isRelease) {
          type = 'release';
        } else if (button === 0) {
          type = 'left_click';
        } else if (button === 1) {
          type = 'middle_click';
        } else if (button === 2) {
          type = 'right_click';
        }
        
        if (type) {
          onMouseEvent({ x, y, type });
        }
      }
    };

    process.stdin.on('data', handleData);

    return () => {
      // Disable mouse reporting on clean up
      process.stdout.write('\x1b[?1000l');
      process.stdout.write('\x1b[?1006l');
      process.stdin.off('data', handleData);
    };
  }, [onMouseEvent]);
};

