# mcp-svelte-docs

A Model Context Protocol (MCP) server that provides efficient access
to Svelte documentation with advanced caching, search capabilities,
and optimized content delivery. This server integrates directly with
Svelte's official documentation, offering both full and compressed
variants suitable for different LLM context window sizes.

> This is a fork of
> [spences10/mcp-svelte-docs](https://github.com/spences10/mcp-svelte-docs)
> with a few modifications:
>
> - **Deeper Integration**: Improved detection of Svelte-related
>   queries across all MCP tools with context-aware keyword detection
> - **Refresh Options**: Configurable refresh intervals (daily or
>   weekly) using command line flags
> - **Prompts Capability**: Added support for MCP Prompts, including
>   documentation overview and quick search functions
> - **Background Initialization**: Faster server starts while docs are
>   being fetched in the background
> - **Testing Tools**: Added test scripts for keyword detection and
>   search functionality

## Features

- 📚 Complete Svelte documentation access through MCP Resources
- 🔍 Advanced search capabilities:
  - Document type filtering (API, Tutorial, Example, Error)
  - Section hierarchy awareness
  - Intelligent relevance scoring based on term frequency, section
    importance, document type relevance, and key concept weighting
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
- 🧠 Smart prompts for documentation overview and quick search
- 🤖 Enhanced Claude Code integration
- 💾 Efficient caching with LibSQL
- 🔄 Configurable refresh intervals (daily or weekly)
- 📦 Support for package-specific documentation (Svelte, Kit, CLI)
- 📏 Smart content chunking for large documents
- 🗜️ Compressed variants for smaller context windows

## Configuration

### Cline Configuration

Add this to your Cline MCP settings:

```json
{
	"mcpServers": {
		"svelte-docs": {
			"command": "npx",
			"args": ["-y", "mcp-svelte-docs"],
			"env": {
				"LIBSQL_URL": "file:./svelte-docs.db",
				"LIBSQL_AUTH_TOKEN": "your-auth-token-if-using-remote-db"
			}
		}
	}
}
```

With refresh option:

```json
{
	"mcpServers": {
		"svelte-docs": {
			"command": "npx",
			"args": ["-y", "mcp-svelte-docs", "--refresh=WEEKLY"],
			"env": {
				"LIBSQL_URL": "file:./svelte-docs.db"
			}
		}
	}
}
```

> **Note:** The server runs over standard I/O transport, not HTTP. It
> doesn't require any open ports for normal operation.

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
				"LIBSQL_URL=file:./svelte-docs.db LIBSQL_AUTH_TOKEN=your-token npx -y mcp-svelte-docs"
			]
		}
	}
}
```

With refresh option:

```json
{
	"mcpServers": {
		"svelte-docs": {
			"command": "wsl.exe",
			"args": [
				"bash",
				"-c",
				"LIBSQL_URL=file:./svelte-docs.db npx -y mcp-svelte-docs --refresh=WEEKLY"
			]
		}
	}
}
```

### Environment Variables

- `LIBSQL_URL` (optional): URL for the LibSQL database. Defaults to
  `file:./svelte-docs.db`
- `LIBSQL_AUTH_TOKEN` (optional): Auth token for remote LibSQL
  database

### Command Line Options

- `--refresh` or `--refresh=DAILY`: Force refresh of documentation on
  startup and set daily refresh interval
- `--refresh=WEEKLY`: Force refresh of documentation on startup and
  set weekly refresh interval

## API

The server implements MCP Resources, Tools, and Prompts:

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
awareness. (Renamed from `search_docs` in the original repository)

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
- `package` (string, optional): Filter by package (**New parameter**)
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

// Package-specific Search (New capability)
{
  "query": "server routes",
  "doc_type": "all",
  "package": "kit"
}
```

#### svelte_get_next_chunk

Retrieve subsequent chunks of large Svelte documentation. (Renamed
from `get_next_chunk` in the original repository)

Parameters:

- `uri` (string, required): Document URI
- `chunk_number` (number, required): Chunk number to retrieve
  (1-based)

### Prompts

#### svelte_docs_overview

Get an overview of Svelte documentation.

Parameters:

- `package` (string, optional): Filter by package
  - Values: 'svelte', 'kit', 'cli'
  - Default: 'svelte'

#### svelte_quick_search

Quickly search Svelte documentation for specific terms.

Parameters:

- `query` (string, required): The search term

## Automatic Svelte Query Detection

The server features an intelligent keyword detection system that:

1. Recognizes Svelte-specific terminology
2. Identifies context-dependent terms (requires Svelte context)
3. Works across all MCP tools, not just Svelte-specific ones
4. Suggests using the svelte_search_docs tool when relevant

This helps Claude Code automatically discover Svelte documentation
when users ask questions that might benefit from it, even without
explicitly asking for Svelte docs.

## Development

### Setup

1. Clone the repository
2. Install dependencies: `pnpm install`
3. Build the project: `pnpm build`
4. Run in development mode:

```bash
# With debug inspector UI (runs on ports 5173 and 3000)
pnpm dev -- --mcp-debug

# Without inspector (runs on stdio only, recommended for production)
pnpm start

# Test with mcp-cli
npx @wong2/mcp-cli node dist/index.js --refresh=DAILY
```

> **Note:** The MCP Inspector debug UI is only needed for development
> and troubleshooting.

### Testing

The server includes test scripts for key functionality:

```bash
# Test keyword detection
pnpm test:keywords

# Test search functionality
pnpm test:search

# Run all tests
pnpm test
```

### Publishing

1. Update version in package.json
2. Build the project: `pnpm build`
3. Publish to npm: `pnpm publish`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Originally created by [Scott Spence](https://github.com/spences10)
- Built on the
  [Model Context Protocol](https://github.com/modelcontextprotocol)
- Powered by [Svelte Documentation](https://svelte.dev)
- Uses [LibSQL](https://github.com/libsql/libsql) for efficient
  caching
