# mcp-svelte-docs

A Model Context Protocol (MCP) server that provides efficient access
to Svelte documentation with advanced caching, search capabilities,
and optimised content delivery. This server integrates directly with
Svelte's official documentation, offering both full and compressed
variants suitable for different LLM context window sizes.

<a href="https://glama.ai/mcp/servers/wu4hy1xtjb">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/wu4hy1xtjb/badge" />
</a>

## Features

- 📚 Complete Svelte documentation access through MCP Resources
- 🔍 Advanced search capabilities:
  - Document type filtering (API, Tutorial, Example, Error)
  - Section hierarchy awareness
  - Intelligent relevance scoring based on:
    - Term frequency
    - Section importance
    - Document type relevance
    - Term weighting for key concepts
  - Context-aware result excerpts
  - Category-based result grouping
  - Exact phrase matching with quotes
  - Related term suggestions
- 🔎 Automatic Svelte query detection:
  - Recognizes Svelte-related terms across all MCP tools
  - Context-aware keyword detection
  - Detects Svelte runes, components, lifecycle, and other key
    concepts
  - Proactively suggests Svelte documentation when relevant
- 💾 Efficient caching with LibSQL
- 🔄 Automatic content freshness checks
- 📦 Support for package-specific documentation (Svelte, Kit, CLI)
- 📏 Smart content chunking for large documents
- 🗜️ Compressed variants for smaller context windows
- 🏗️ Built on the Model Context Protocol

## Configuration

This server requires configuration through your MCP client. Here are
examples for different environments:

### Cline Configuration

Add this to your Cline MCP settings:

```json
{
	"mcpServers": {
		"svelte-docs": {
			"command": "npx",
			"args": ["-y", "mcp-svelte-docs"],
			"env": {
				"LIBSQL_URL": "file:local.db",
				"LIBSQL_AUTH_TOKEN": "your-auth-token-if-using-remote-db"
			}
		}
	}
}
```

> **Note:** The server runs over standard I/O transport, not HTTP. It
> doesn't require any open ports for normal operation. The MCP
> Inspector debug mode is only used during development.

### Claude Desktop with WSL Configuration

For WSL environments, add this to your Claude Desktop configuration:

```json
{
	"mcpServers": {
		"svelte-docs": {
			"command": "wsl.exe",
			"args": [
				"bash",
				"-c",
				"LIBSQL_URL=file:local.db LIBSQL_AUTH_TOKEN=your-token npx -y mcp-svelte-docs"
			]
		}
	}
}
```

### Environment Variables

The server supports the following environment variables:

- `LIBSQL_URL` (optional): URL for the LibSQL database. Defaults to
  `file:local.db`
- `LIBSQL_AUTH_TOKEN` (optional): Auth token for remote LibSQL
  database

## API

The server implements both MCP Resources and Tools:

### Resources

Access documentation through these URIs:

- `svelte-docs://docs/llms.txt` - Documentation index
- `svelte-docs://docs/llms-full.txt` - Complete documentation
- `svelte-docs://docs/llms-small.txt` - Compressed documentation
- `svelte-docs://docs/{package}/llms.txt` - Package-specific
  documentation
  - Supported packages: svelte, kit, cli

### Tools

#### svelte_search_docs

Enhanced search functionality with advanced filtering and context
awareness.

Parameters:

- `query` (string, required): Search keywords or natural language
  query
- `doc_type` (string, optional): Filter by documentation type
  - Values: 'api', 'tutorial', 'example', 'error', 'all'
  - Default: 'all'
- `context` (number, optional): Number of surrounding paragraphs (0-3)
  - Default: 1
- `include_hierarchy` (boolean, optional): Include section hierarchy
  - Default: true
- `package` (string, optional): Filter by package
  - Values: 'svelte', 'kit', 'cli'

Example Usage:

```json
// API Reference Search
{
  "query": "bind:value directive",
  "doc_type": "api",
  "context": 1
}

// Tutorial Search with Exact Phrase
{
  "query": "\"dynamic routes\" sveltekit",
  "doc_type": "tutorial",
  "context": 2,
  "include_hierarchy": true
}

// Package-specific Search
{
  "query": "server routes",
  "doc_type": "all",
  "package": "kit"
}
```

#### svelte_get_next_chunk

Retrieve subsequent chunks of large Svelte documentation.

Parameters:

- `uri` (string, required): Document URI
- `chunk_number` (number, required): Chunk number to retrieve
  (1-based)

## Development

### Setup

1. Clone the repository
2. Install dependencies:

```bash
pnpm install
```

3. Build the project:

```bash
pnpm build
```

4. Run in development mode:

```bash
# With debug inspector UI (runs on ports 5173 and 3000)
pnpm dev -- --mcp-debug

# Without inspector (runs on stdio only, recommended for production)
pnpm start
```

> **Note:** The MCP Inspector debug UI runs on port 5173 with a proxy
> server on port 3000. These ports must be available. The debug UI is
> only needed for development and troubleshooting - it's not required
> for normal operation.

### Publishing

1. Update version in package.json
2. Build the project:

```bash
pnpm build
```

3. Publish to npm:

```bash
pnpm publish
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built on the
  [Model Context Protocol](https://github.com/modelcontextprotocol)
- Powered by [Svelte Documentation](https://svelte.dev)
- Uses [LibSQL](https://github.com/libsql/libsql) for efficient
  caching
