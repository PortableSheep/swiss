// Heuristic parsing engine for Jira story descriptions
export interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
  custom?: boolean;
}

export function parseDescription(description: string, summary: string): { text: string; completed: boolean }[] {
  if (!description || description.trim() === 'No description provided.' || description.trim() === '') {
    return [{ text: `Complete: ${summary}`, completed: false }];
  }

  const items: { text: string; completed: boolean }[] = [];
  const lines = description.split('\n').map(l => l.trim());

  // 1. Markdown Checkbox Parsing: Matches: - [ ] Task or - [x] Task or * [ ] Task or * [x] Task
  const checkboxRegex = /^[-*]\s+\[([ xX])\]\s+(.+)$/;
  for (const line of lines) {
    const match = line.match(checkboxRegex);
    if (match) {
      const completed = match[1].toLowerCase() === 'x';
      const text = match[2].trim();
      if (text) {
        items.push({ text, completed });
      }
    }
  }

  if (items.length > 0) {
    return items;
  }

  // 2. Plain Lists Parsing (only if multiple exist)
  // Matches: - Task or * Task or 1. Task or 1) Task
  const listRegex = /^([-*]|\d+[.)])\s+(.+)$/;
  const candidateListItems: string[] = [];
  for (const line of lines) {
    const match = line.match(listRegex);
    if (match) {
      const text = match[2].trim();
      if (text && text.length > 3) {
        candidateListItems.push(text);
      }
    }
  }

  if (candidateListItems.length >= 2) {
    return candidateListItems.map(text => ({ text, completed: false }));
  }

  // 3. Verb-Sentence Parsing
  const verbs = [
    'implement', 'build', 'setup', 'draft', 'add', 'fix', 'verify', 
    'refactor', 'create', 'update', 'ensure', 'integrate', 'test',
    'design', 'configure', 'optimize', 'resolve', 'document', 'cleanup',
    'write', 'deploy', 'run', 'migrate', 'analyze', 'debug'
  ];
  
  const sentences = description
    .split(/[.!?]+(?:\s+|$)/)
    .map(s => s.trim())
    .filter(s => s.length > 5);

  const verbSentences: string[] = [];
  for (const sentence of sentences) {
    const firstWord = sentence.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
    if (firstWord && verbs.includes(firstWord)) {
      const sanitized = sentence.charAt(0).toUpperCase() + sentence.slice(1);
      verbSentences.push(sanitized);
    }
  }

  if (verbSentences.length > 0) {
    return verbSentences.map(text => ({ text, completed: false }));
  }

  // 4. Fallback
  return [{ text: `Complete: ${summary}`, completed: false }];
}
