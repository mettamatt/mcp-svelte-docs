# mcp-svelte-docs

## 0.0.15

### Patch Changes

- fix: Improve exact phrase matching for quoted search terms
- fix: Ensure phrase-only searches return proper results even without keyword matches
- refactor: Extract common search result handling into helper functions
- chore: Code formatting with Prettier

## 0.0.14

### Patch Changes

- feat: Add exact phrase matching using quoted search terms
- feat: Implement related search term suggestions based on query
  context
- feat: Create comprehensive related terms mapping for Svelte concepts
- docs: Update README to document new search capabilities

## 0.0.13

### Patch Changes

- feat: Improve tool response formatting for better LLM consumption
- feat: Rename tools with `svelte_` prefix to prevent namespace
  conflicts
- docs: Update README to reflect new tool names and improved response
  format

## 0.0.12

### Patch Changes

- refactor: Migrate to higher-level McpServer API from MCP TypeScript
  SDK
- feat: Implement Zod schema validation for tool parameters
- feat: Add support for resource templates with path parameters

## 0.0.11

### Patch Changes

- feat: Enhance documentation search with advanced categorization and
  term weighting

## 0.0.10

### Patch Changes

- feat: Implement comprehensive Svelte documentation server with
  advanced search and resource management

## 0.0.9

### Patch Changes

- update search and documentation

## 0.0.8

### Patch Changes

- Refactor index.ts to modularize database and document handling.
  Removed legacy database client and caching functions, integrating
  new document-fetching and processing utilities. Enhanced chunking
  and metadata management for large documents, improving performance
  and maintainability. This update sets the stage for more efficient
  document retrieval and search capabilities.

## 0.0.7

### Patch Changes

- Update README.md to improve clarity on text search features and
  introduce a roadmap section outlining future enhancements, including
  semantic search implementation using embeddings.

## 0.0.6

### Patch Changes

- Update README.md to reflect new server link and badge for
  documentation access

## 0.0.5

### Patch Changes

- fix: update database client configuration to support environment
  variables for URL and authentication token

## 0.0.4

### Patch Changes

- init
