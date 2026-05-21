import { ReactElement } from 'react';

export interface PluginProps {
  args: string[];
  options: Record<string, any>;
  config: Record<string, any>;
  suppressQuit?: (suppress: boolean) => void;
}

export interface ConfigFieldSchema {
  key: string;
  label: string;
  description: string;
}

export interface SwissPlugin {
  name: string;
  description: string;
  default: (props: PluginProps) => ReactElement;
  configFields?: ConfigFieldSchema[];
}
