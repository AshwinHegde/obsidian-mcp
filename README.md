# Obsidian MCP Server

[![smithery badge](https://smithery.ai/badge/obsidian-mcp)](https://smithery.ai/server/obsidian-mcp)

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that enables AI assistants to interact with Obsidian vaults, providing tools for reading, creating, editing and managing notes and tags.

## Warning!!!

This MCP has read and write access (if you allow it). Please. PLEASE backup your Obsidian vault prior to using obsidian-mcp to manage your notes. I recommend using git, but any backup method will work. These tools have been tested, but not thoroughly, and this MCP is in active development.

## Features

- Read and search notes in your vault
- Create new notes and directories
- Edit existing notes
- Move and delete notes
- Manage tags (add, remove, rename)
- Search vault contents

## Requirements

- Node.js 20 or higher (might work on lower, but I haven't tested it)
- An Obsidian vault

## Setup (Running from Local Clone)

```bash
# Clone the repository (if you haven't already)
# git clone <your-fork-url>
# cd <repository-folder>

# Install dependencies
npm install

# Build the server code
npm run build
```

Then add to your Claude Desktop configuration:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
    "mcpServers": {
        "obsidian-local": { // You can name this server entry whatever you like
            "command": "node",
            "args": [
                "<absolute-path-to-this-repository>/build/main.js", 
                "/path/to/your/vault", 
                "/path/to/your/vault2" // Add more vault paths if needed
            ]
        }
    }
}
```

Replace `<absolute-path-to-this-repository>` with the actual absolute path to the directory where you cloned this repository. For example:

MacOS/Linux:
`/Users/username/projects/obsidian-mcp-fork/build/main.js`

Windows:
`C:\Users\username\projects\obsidian-mcp-fork\build\main.js` (Remember to use double backslashes `\\` in JSON)

Replace `/path/to/your/vault` with the absolute path to your Obsidian vault.

Restart Claude for Desktop after saving the configuration. You should see the hammer icon appear, indicating the server is connected.

If you have connection issues, check the logs at:

- MacOS: `~/Library/Logs/Claude/mcp*.log`
- Windows: `%APPDATA%\Claude\logs\mcp*.log`

## Available Tools

- `read-note` - Read the contents of a note
- `create-note` - Create a new note
- `edit-note` - Edit an existing note
- `delete-note` - Delete a note
- `move-note` - Move a note to a different location
- `create-directory` - Create a new directory
- `read-canvas` - Read and parse the JSON content of a canvas file
- `create-canvas` - Create a new canvas file with specified JSON content
- `edit-canvas` - Replace the JSON content of an existing canvas file
- `delete-canvas` - Delete a canvas file (moves to .trash by default)
- `search-vault` - Search notes in the vault
- `add-tags` - Add tags to a note
- `remove-tags` - Remove tags from a note
- `rename-tag` - Rename a tag across all notes
- `manage-tags` - List and organize tags
- `list-available-vaults` - List all available vaults (helps with multi-vault setups)

## Documentation

Additional documentation can be found in the `docs` directory:

- `creating-tools.md` - Guide for creating new tools
- `tool-examples.md` - Examples of using the available tools

## Security

This server requires access to your Obsidian vault directory. When configuring the server, make sure to:

- Only provide access to your intended vault directory
- Review tool actions before approving them

## Troubleshooting

Common issues:

1. **Server not showing up in Claude Desktop**
   - Verify your configuration file syntax (`claude_desktop_config.json`). Ensure paths are absolute and correct.
   - Make sure the server process can be started (check permissions, Node.js installation).
   - Check the MCP logs mentioned in the Setup section.
   - Restart Claude Desktop.

2. **Permission errors**
   - Ensure the vault path(s) provided in the configuration are readable/writable by the user running the Node.js process.
   - Check file permissions within your vault.

3. **Tool execution failures**
   - Check Claude Desktop logs (see Setup section).
   - Check the console output where you started the node server (if you ran it manually).

## License

MIT
