#!/usr/bin/env node

import {
	McpServer,
	ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListResourcesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { db, init_db, verify_db } from './db/client.js';
import {
	DocVariant,
	fetch_docs,
	get_doc_resources,
	init_docs,
	Package,
	should_update_docs,
} from './docs/fetcher.js';
import { search_docs, SearchOptions } from './search/index.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
);
const { name, version } = pkg;

// Create MCP server instance
const server = new McpServer({
	name,
	version,
});

// Define the svelte_search_docs tool
server.tool(
	'svelte_search_docs',
	'Search Svelte documentation using specific technical terms and concepts. Returns relevant documentation sections with context.',
	{
		query: z
			.string()
			.describe('Search keywords or natural language query'),
		doc_type: z
			.enum(['api', 'tutorial', 'example', 'error', 'all'])
			.default('all')
			.describe('Filter by documentation type')
			.optional(),
		context: z
			.number()
			.min(0)
			.max(3)
			.default(1)
			.describe('Number of surrounding paragraphs')
			.optional(),
		include_hierarchy: z
			.boolean()
			.default(true)
			.describe('Include section hierarchy')
			.optional(),
		package: z
			.enum(['svelte', 'kit', 'cli'])
			.describe('Filter by package')
			.optional(),
	},
	async (params, _extra) => {
		try {
			const search_params: SearchOptions = {
				query: params.query,
				doc_type: params.doc_type as SearchOptions['doc_type'],
				context: params.context,
				include_hierarchy: params.include_hierarchy,
				package: params.package as SearchOptions['package'],
			};

			const { results, related_suggestions } =
				await search_docs(search_params);

			// Format results in a more readable way for Claude
			let formattedResponse = '';

			if (results.length === 0) {
				formattedResponse = 'No results found for your query.';

				// Add related suggestions if available
				if (related_suggestions && related_suggestions.length > 0) {
					formattedResponse +=
						'\n\n**Related search terms you might try:**\n';
					related_suggestions.forEach((suggestion) => {
						formattedResponse += `- ${suggestion.term}\n`;
					});
				}
			} else {
				// Group by category for better organization
				const categoryGroups: Record<string, typeof results> = {};
				results.forEach((result) => {
					const category = result.category || 'other';
					if (!categoryGroups[category]) {
						categoryGroups[category] = [];
					}
					categoryGroups[category].push(result);
				});

				// Build a well-formatted, easy-to-consume response
				formattedResponse = '# Search Results\n\n';

				Object.entries(categoryGroups).forEach(
					([category, groupResults]) => {
						formattedResponse += `## ${category.charAt(0).toUpperCase() + category.slice(1)}\n\n`;

						groupResults.forEach((result) => {
							// Add hierarchy if included
							if (result.hierarchy && params.include_hierarchy) {
								formattedResponse += `### ${result.hierarchy.join(' > ')}\n\n`;
							}

							// Add content with type and package info
							formattedResponse += `**Type:** ${result.type} | **Package:** ${result.package || 'core'}\n\n`;
							formattedResponse += `${result.content}\n\n`;
							formattedResponse += `---\n\n`;
						});
					},
				);

				// Add related suggestions if available
				if (related_suggestions && related_suggestions.length > 0) {
					formattedResponse += '## Related Topics\n\n';
					formattedResponse += 'You might also want to explore:\n\n';
					related_suggestions.forEach((suggestion) => {
						formattedResponse += `- ${suggestion.term}\n`;
					});
				}
			}

			return {
				content: [
					{
						type: 'text',
						text: formattedResponse,
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: 'text',
						text: `Error searching docs: ${
							error instanceof Error ? error.message : String(error)
						}`,
					},
				],
				isError: true,
			};
		}
	},
);

// Define the svelte_get_next_chunk tool
server.tool(
	'svelte_get_next_chunk',
	'Retrieve subsequent chunks of large Svelte documentation',
	{
		uri: z.string().describe('Document URI'),
		chunk_number: z
			.number()
			.min(1)
			.describe('Chunk number to retrieve (1-based)'),
	},
	async (params, _extra) => {
		try {
			const { uri, chunk_number } = params;
			if (!uri.startsWith('svelte-docs://docs/')) {
				throw new Error(`Invalid URI: ${uri}`);
			}

			const path = uri.substring('svelte-docs://docs/'.length);
			let package_name: Package | undefined;
			let variant: DocVariant | undefined;

			if (
				path.startsWith('svelte/') ||
				path.startsWith('kit/') ||
				path.startsWith('cli/')
			) {
				const [pkg] = path.split('/') as [Package];
				package_name = pkg;
			} else {
				const variant_map: Record<string, DocVariant> = {
					'llms.txt': 'llms',
					'llms-full.txt': 'llms-full',
					'llms-small.txt': 'llms-small',
				};
				variant = variant_map[path];
				if (!variant) {
					throw new Error(`Invalid doc variant: ${path}`);
				}
			}

			const result = await db.execute({
				sql: `SELECT content FROM docs 
					  WHERE package = ? AND variant = ?
					  ORDER BY id
					  LIMIT 1 OFFSET ?`,
				args: [
					package_name === undefined ? null : package_name,
					variant === undefined ? null : variant,
					chunk_number - 1,
				],
			});

			if (result.rows.length === 0) {
				return {
					content: [
						{
							type: 'text',
							text: 'No more chunks available',
						},
					],
					isError: true,
				};
			}

			return {
				content: [
					{
						type: 'text',
						text: String(result.rows[0].content),
					},
				],
			};
		} catch (error) {
			return {
				content: [
					{
						type: 'text',
						text: `Error retrieving chunk: ${
							error instanceof Error ? error.message : String(error)
						}`,
					},
				],
				isError: true,
			};
		}
	},
);

// Define the llms.txt resource
server.resource(
	'llms-txt',
	'svelte-docs://docs/llms.txt',
	{
		description:
			'Standard documentation covering Svelte core concepts and features',
	},
	async (uri, _extra) => {
		try {
			if (await should_update_docs(undefined, 'llms')) {
				await fetch_docs(undefined, 'llms');
			}

			const result = await db.execute({
				sql: `SELECT content FROM docs WHERE package IS NULL AND variant = ?`,
				args: ['llms'],
			});

			if (result.rows.length === 0) {
				throw new Error('Documentation not found');
			}

			return {
				contents: [
					{
						uri: uri.href,
						text: String(result.rows[0].content),
						mimeType: 'text/plain',
					},
				],
			};
		} catch (error) {
			throw new Error(
				`Error fetching docs: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	},
);

// Define the llms-full.txt resource
server.resource(
	'llms-full-txt',
	'svelte-docs://docs/llms-full.txt',
	{
		description:
			'Comprehensive documentation including advanced topics and detailed examples',
	},
	async (uri, _extra) => {
		try {
			if (await should_update_docs(undefined, 'llms-full')) {
				await fetch_docs(undefined, 'llms-full');
			}

			const result = await db.execute({
				sql: `SELECT content FROM docs WHERE package IS NULL AND variant = ?`,
				args: ['llms-full'],
			});

			if (result.rows.length === 0) {
				throw new Error('Documentation not found');
			}

			return {
				contents: [
					{
						uri: uri.href,
						text: String(result.rows[0].content),
						mimeType: 'text/plain',
					},
				],
			};
		} catch (error) {
			throw new Error(
				`Error fetching docs: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	},
);

// Define the llms-small.txt resource
server.resource(
	'llms-small-txt',
	'svelte-docs://docs/llms-small.txt',
	{
		description:
			'Condensed documentation focusing on essential concepts',
	},
	async (uri, _extra) => {
		try {
			if (await should_update_docs(undefined, 'llms-small')) {
				await fetch_docs(undefined, 'llms-small');
			}

			const result = await db.execute({
				sql: `SELECT content FROM docs WHERE package IS NULL AND variant = ?`,
				args: ['llms-small'],
			});

			if (result.rows.length === 0) {
				throw new Error('Documentation not found');
			}

			return {
				contents: [
					{
						uri: uri.href,
						text: String(result.rows[0].content),
						mimeType: 'text/plain',
					},
				],
			};
		} catch (error) {
			throw new Error(
				`Error fetching docs: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	},
);

// Define the svelte resource
server.resource(
	'svelte-docs',
	'svelte-docs://docs/svelte/llms.txt',
	{
		description:
			'Documentation specific to Svelte core library features and APIs',
	},
	async (uri, _extra) => {
		try {
			if (await should_update_docs('svelte')) {
				await fetch_docs('svelte');
			}

			const result = await db.execute({
				sql: `SELECT content FROM docs WHERE package = ? AND variant IS NULL`,
				args: ['svelte'],
			});

			if (result.rows.length === 0) {
				throw new Error('Documentation not found');
			}

			return {
				contents: [
					{
						uri: uri.href,
						text: String(result.rows[0].content),
						mimeType: 'text/plain',
					},
				],
			};
		} catch (error) {
			throw new Error(
				`Error fetching docs: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	},
);

// Define the kit resource
server.resource(
	'kit-docs',
	'svelte-docs://docs/kit/llms.txt',
	{
		description:
			'Documentation for SvelteKit application framework and routing',
	},
	async (uri, _extra) => {
		try {
			if (await should_update_docs('kit')) {
				await fetch_docs('kit');
			}

			const result = await db.execute({
				sql: `SELECT content FROM docs WHERE package = ? AND variant IS NULL`,
				args: ['kit'],
			});

			if (result.rows.length === 0) {
				throw new Error('Documentation not found');
			}

			return {
				contents: [
					{
						uri: uri.href,
						text: String(result.rows[0].content),
						mimeType: 'text/plain',
					},
				],
			};
		} catch (error) {
			throw new Error(
				`Error fetching docs: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	},
);

// Define the cli resource
server.resource(
	'cli-docs',
	'svelte-docs://docs/cli/llms.txt',
	{
		description:
			'Documentation for Svelte command-line tools and utilities',
	},
	async (uri, _extra) => {
		try {
			if (await should_update_docs('cli')) {
				await fetch_docs('cli');
			}

			const result = await db.execute({
				sql: `SELECT content FROM docs WHERE package = ? AND variant IS NULL`,
				args: ['cli'],
			});

			if (result.rows.length === 0) {
				throw new Error('Documentation not found');
			}

			return {
				contents: [
					{
						uri: uri.href,
						text: String(result.rows[0].content),
						mimeType: 'text/plain',
					},
				],
			};
		} catch (error) {
			throw new Error(
				`Error fetching docs: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	},
);

// Register resources list handler
server.server.setRequestHandler(
	ListResourcesRequestSchema,
	async () => {
		return await get_doc_resources();
	},
);

// Run server
async function run_server() {
	try {
		await init_db();
		console.error('Initialized database schema');

		await init_docs();
		await verify_db();
		console.error('Verified database population');

		const transport = new StdioServerTransport();
		await server.connect(transport);
		console.error('Svelte Docs MCP Server running on stdio');
	} catch (error) {
		console.error('Fatal error during server initialization:', error);
		process.exit(1);
	}
}

run_server().catch((error) => {
	console.error('Fatal error running server:', error);
	process.exit(1);
});
