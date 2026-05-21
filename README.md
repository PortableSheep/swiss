# Swiss TUI Toolkit - Documentation

Swiss is a modular, developer-centric TUI toolkit built with TypeScript, React, and Ink. It is designed to be highly extensible through a native plugin system, allowing you to create a customized developer dashboard in your terminal (perfect for tiling terminal emulators like Ghostty).

## Core Features
- **Modular Plugin Engine**: Automatically discovers and loads plugins from `src/plugins/` and `.swiss/plugins/`.
- **Centralized Configuration**: All plugins share a secure configuration file located at `~/.swiss.json`.
- **Unified Global Controls**: 
  - `q`: Quit any plugin instantly.
- **Shared UI Kit**: Built-in components like `<Header />` and `<Layout />` for a consistent look across tools.

---

## Included Plugins

### 1. Git (`swiss git`)
Interactive version control management.
- **Features**: 
  - Real-time status view (Staged vs. Unstaged).
  - Branch management: Searchable list to switch branches, or create new ones (`B`).
  - One-key staging (`s` for `git add .`).
  - Commit flow (`c`) with inline text input.
  - Sync actions: Push (`P`), Pull (`p`), and Fetch with Prune (`f`).

### 2. Jira (`swiss jira`)
Manage your sprint tasks and issue details.
- **Features**: 
  - Navigable list of assigned issues.
  - Split-pane detail view showing summary, priority, and description.
  - **Config**: Needs `jira.url` and `jira.token` in `~/.swiss.json`.

### 3. PR Monitor (`swiss pr`)
Keep track of pull requests across your team.
- **Features**: 
  - Tracks "Your PRs" and "Pending Review".
  - Displays CI status (Pass/Fail/Running) and Approval status.
  - Built-in alerts for new PRs from teammates.
  - **Config**: Requires `pr.githubToken` in `~/.swiss.json`.

### 4. Presence (`swiss presence`)
Sync your communication status with your work context.
- **Features**: 
  - Manually set status: Available (`a`), Busy (`b`), or DND (`d`).
  - Visual status indicator (Green/Red/Yellow).
  - Syncs status message to MS Teams and Slack (placeholder logic included).

### 5. Request (`swiss request`)
An API workbench powered by your `RawRequest` tool.
- **Features**: 
  - Interactive URL editing (`e`).
  - Change methods (`m`).
  - Executes requests using the `RawRequest` binary and displays the response in a dedicated pane.

### 6. Logs (`swiss logs`)
Real-time log monitoring (mocked for GCP/Cloud Logging).
- **Features**: 
  - Live log tailing with color-coded severity (INFO/WARN/ERROR).
  - Pause/Resume (`p`) to inspect specific lines.
  - Clear logs (`c`) or switch services (`s`).

### 7. Scratchpad (`swiss scratch`)
A persistent developer notepad.
- **Features**: 
  - Edit mode (`e`) for entering JSON, tokens, or notes.
  - Automatically persists content to `~/.swiss_scratch.txt`.
  - Quick clear (`x`) for sensitive data.

---

## Configuration (`~/.swiss.json`)

Example configuration structure:
```json
{
  "pr": {
    "githubToken": "your_token_here",
    "repo": "org/repo"
  },
  "jira": {
    "url": "https://your-org.atlassian.net",
    "token": "your_api_token"
  },
  "logs": {
    "defaultService": "api-service"
  }
}
```

## Development
- **Build**: `npm run build`
- **Run**: `node dist/cli.js <plugin> [args]`
- **Add Local Plugin**: Create a `.js` or `.tsx` file in `.swiss/plugins/` that exports a default React component.
