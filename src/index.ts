#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	// Removed prompts references:
	// ListPromptsRequestSchema,
	// GetPromptRequestSchema,
	// Also remove them from "capabilities"
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	Tool,
	ResourceContents,
} from '@modelcontextprotocol/sdk/types.js';

import { z } from 'zod';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// -- Our DB & doc imports
import { db, init_db, verify_db } from './db/client.js';
import {
	init_docs,
	get_doc_resources,
	should_update_docs,
	fetch_docs,
	DocVariant,
	Package,
	setRefreshMode,
} from './docs/fetcher.js';
import { search_docs, TERM_WEIGHTS } from './search/index.js';

// Keywords that need context
const CONTEXT_REQUIRED_TERMS = new Set([
	'error',
	'warning',
	'debug',
	'store',
	'load',
	'action',
]);

// Additional strong Svelte indicators
const ADDITIONAL_SVELTE_TERMS = new Set([
	'svelte',
	'sveltekit',
	'svelte.js',
	'runes',
	'state',
]);

// Simple argument parsing
const args = process.argv.slice(2);
let refreshMode: 'DAILY' | 'WEEKLY' | undefined;
for (let i = 0; i < args.length; i++) {
	const arg = args[i].toUpperCase();
	if (arg === '--REFRESH' || arg === '--REFRESH=DAILY') {
		refreshMode = 'DAILY';
	} else if (arg === '--REFRESH=WEEKLY') {
		refreshMode = 'WEEKLY';
	}
}
if (refreshMode) {
	console.error(
		`Setting documentation refresh mode to: ${refreshMode}`,
	);
	setRefreshMode(refreshMode);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for server metadata
const pkg = JSON.parse(
	readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
);
const { name, version } = pkg;

// ------------------------------------------------------------
// 1) Create the Svelte MCP Server instance
// ------------------------------------------------------------
const server = new Server(
	{ name, version },
	{
		capabilities: {
			tools: {}, // STILL providing Tools
			// Removed "prompts" capability
			resources: {}, // STILL providing Resources if you want
		},
	},
);

// ------------------------------------------------------------
// 2) Define Tools
// ------------------------------------------------------------
const SVELTE_SEARCH_DOCS_TOOL: Tool = {
	name: 'svelte_search_docs',
	description:
		'Search Svelte documentation using specific technical terms and concepts. ' +
		'Returns relevant documentation sections with context.',
	inputSchema: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Search keywords or natural language query',
			},
			doc_type: {
				type: 'string',
				description:
					'One of api, tutorial, example, error, or all (default)',
				enum: ['api', 'tutorial', 'example', 'error', 'all'],
				default: 'all',
			},
			context: {
				type: 'number',
				description:
					'Number of surrounding paragraphs (0-3, default 1)',
				default: 1,
			},
			include_hierarchy: {
				type: 'boolean',
				description: 'Include section hierarchy in results',
				default: true,
			},
			package: {
				type: 'string',
				description: 'Filter by package (svelte, kit, or cli)',
				enum: ['svelte', 'kit', 'cli'],
			},
		},
		required: ['query'],
	},
};

const SVELTE_GET_NEXT_CHUNK_TOOL: Tool = {
	name: 'svelte_get_next_chunk',
	description:
		'Retrieve subsequent chunks of large Svelte documentation by URI.',
	inputSchema: {
		type: 'object',
		properties: {
			uri: {
				type: 'string',
				description:
					'Document URI (e.g., svelte-docs://docs/llms.txt)',
			},
			chunk_number: {
				type: 'number',
				description: 'Chunk number to retrieve (1-based)',
				minimum: 1,
			},
		},
		required: ['uri', 'chunk_number'],
	},
};

// ------------------------------------------------------------
// 3) List Tools
// ------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [SVELTE_SEARCH_DOCS_TOOL, SVELTE_GET_NEXT_CHUNK_TOOL],
	};
});

// ------------------------------------------------------------
// 4) Helper: Detect if query might be Svelte-related
// ------------------------------------------------------------
function isSvelteQuery(query: string): boolean {
	const lowercaseQuery = query.toLowerCase();

	// Check for strong indicators first
	for (const term of ADDITIONAL_SVELTE_TERMS) {
		if (lowercaseQuery.includes(term)) {
			return true;
		}
	}

	// Check for weighted terms from the existing system
	const queryTerms = lowercaseQuery.split(/\s+/);

	// Count direct term matches
	let svelteTermMatches = 0;
	for (const term of queryTerms) {
		if (term.length < 3) continue;

		// If we have a direct match with a known weighted term
		if (term in TERM_WEIGHTS) {
			// If this term requires context, skip counting it alone
			if (CONTEXT_REQUIRED_TERMS.has(term)) {
				continue;
			}
			svelteTermMatches++;
			if (svelteTermMatches >= 1) {
				return true;
			}
		}
	}

	// If we have a context-requiring term, check if there's at least one more Svelte term
	if (
		queryTerms.some((term: string) =>
			CONTEXT_REQUIRED_TERMS.has(term),
		)
	) {
		for (const term of queryTerms) {
			if (term in TERM_WEIGHTS && !CONTEXT_REQUIRED_TERMS.has(term)) {
				return true;
			}
		}
	}
	return false;
}

// ------------------------------------------------------------
// 5) Handle CallTool Requests
// ------------------------------------------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name: toolName, arguments: toolArgs } = request.params;

	// Basic guard
	if (!toolArgs) {
		return {
			content: [
				{ type: 'text', text: 'No tool arguments provided.' },
			],
			isError: true,
		};
	}

	try {
		// Auto-detect Svelte queries even if user calls the wrong tool
		if (
			toolName !== 'svelte_search_docs' &&
			'query' in toolArgs &&
			typeof toolArgs.query === 'string' &&
			toolArgs.query.toLowerCase().includes('svelte') &&
			isSvelteQuery(toolArgs.query)
		) {
			console.error(
				`Detected Svelte-related query in ${toolName}: ${toolArgs.query}`,
			);
			return {
				content: [
					{
						type: 'text',
						text: `This query appears to be related to Svelte. Consider using the 'svelte_search_docs' tool with query: "${toolArgs.query}"`,
					},
				],
				isError: false,
			};
		}

		switch (toolName) {
			// ~~~~~~~~~~~~~
			// svelte_search_docs
			// ~~~~~~~~~~~~~
			case 'svelte_search_docs': {
				const schema = z.object({
					query: z.string(),
					doc_type: z
						.enum(['api', 'tutorial', 'example', 'error', 'all'])
						.default('all'),
					context: z.number().min(0).max(3).default(1),
					include_hierarchy: z.boolean().default(true),
					package: z.enum(['svelte', 'kit', 'cli']).optional(),
				});
				const args = schema.parse(toolArgs);

				const { results, related_suggestions } = await search_docs({
					query: args.query,
					doc_type: args.doc_type,
					context: args.context,
					include_hierarchy: args.include_hierarchy,
					package: args.package,
				});

				if (results.length === 0) {
					let notFound = `No results found for your query: "${args.query}"`;
					if (related_suggestions?.length) {
						notFound += '\n\nRelated terms:\n';
						related_suggestions.forEach((s) => {
							notFound += `- ${s.term}\n`;
						});
					}
					return {
						content: [{ type: 'text', text: notFound }],
						isError: false,
					};
				}

				// Format output
				let response = 'SEARCH RESULTS:\n\n';
				results.forEach((r, idx) => {
					response += `[${idx + 1}] `;
					if (r.hierarchy && args.include_hierarchy) {
						response += `${r.hierarchy.join(' > ')}\n`;
					}
					response += `Type: ${r.type} | Package: ${r.package || 'core'}\n`;
					const cleaned = r.content
						.replace(/```[a-z]*\n/g, '')
						.replace(/```$/g, '');
					response += `${cleaned}\n------------------------\n\n`;
				});

				if (related_suggestions?.length) {
					response += 'RELATED TOPICS:\n';
					related_suggestions.forEach((s) => {
						response += `- ${s.term}\n`;
					});
				}

				return {
					content: [{ type: 'text', text: response }],
					isError: false,
				};
			}

			// ~~~~~~~~~~~~~
			// svelte_get_next_chunk
			// ~~~~~~~~~~~~~
			case 'svelte_get_next_chunk': {
				const schema = z.object({
					uri: z.string(),
					chunk_number: z.number().min(1),
				});
				const args = schema.parse(toolArgs);

				if (!args.uri.startsWith('svelte-docs://docs/')) {
					return {
						content: [
							{ type: 'text', text: `Invalid URI: ${args.uri}` },
						],
						isError: true,
					};
				}

				// Derive package/variant from the path
				const path = args.uri.substring('svelte-docs://docs/'.length);
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
						return {
							content: [
								{
									type: 'text',
									text: `Invalid doc variant: ${path}`,
								},
							],
							isError: true,
						};
					}
				}

				// DB query for chunk
				const result = await db.execute({
					sql: `SELECT content FROM docs
                          WHERE (package = ? OR package IS NULL)
                            AND (variant = ? OR variant IS NULL)
                          ORDER BY id
                          LIMIT 1 OFFSET ?`,
					args: [
						package_name ?? null,
						variant ?? null,
						args.chunk_number - 1,
					],
				});

				if (result.rows.length === 0) {
					return {
						content: [
							{ type: 'text', text: 'No more chunks available' },
						],
						isError: true,
					};
				}

				return {
					content: [
						{ type: 'text', text: String(result.rows[0].content) },
					],
					isError: false,
				};
			}

			// ~~~~~~~~~~~~~
			// Unknown tool
			// ~~~~~~~~~~~~~
			default:
				return {
					content: [
						{ type: 'text', text: `Unknown tool: ${toolName}` },
					],
					isError: true,
				};
		}
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		return {
			content: [
				{
					type: 'text',
					text: `Error running tool "${toolName}": ${errMsg}`,
				},
			],
			isError: true,
		};
	}
});

// ------------------------------------------------------------
// 6) Resources Handlers (if you still want them)
// ------------------------------------------------------------
server.setRequestHandler(ListResourcesRequestSchema, async () => {
	try {
		const resources = await get_doc_resources();
		return {
			...resources,
			isError: false, // unify with Brave style
		};
	} catch (error) {
		return {
			contents: [],
			isError: true,
			content: [
				{
					type: 'text',
					text: `Error listing resources: ${
						error instanceof Error ? error.message : String(error)
					}`,
				},
			],
		};
	}
});

server.setRequestHandler(
	ReadResourceRequestSchema,
	async (request) => {
		const { uri } = request.params;
		if (!uri.startsWith('svelte-docs://docs/')) {
			return {
				contents: [],
				isError: true,
				content: [
					{
						type: 'text',
						text: `Unrecognized URI: ${uri}`,
					},
				],
			};
		}

		const path = uri.replace('svelte-docs://docs/', '');
		let package_name: Package | null = null;
		let variant: DocVariant | null = null;
		if (
			path.startsWith('svelte/') ||
			path.startsWith('kit/') ||
			path.startsWith('cli/')
		) {
			const [pkg] = path.split('/');
			package_name = pkg as Package;
		} else {
			const variant_map: Record<string, DocVariant> = {
				'llms.txt': 'llms',
				'llms-full.txt': 'llms-full',
				'llms-small.txt': 'llms-small',
			};
			variant = variant_map[path] ?? null;
		}

		try {
			// Possible forced refresh if you want
			const forceRefresh = refreshMode !== undefined;
			if (
				await should_update_docs(
					package_name ?? undefined,
					variant ?? undefined,
					forceRefresh,
				)
			) {
				console.error(
					`Updating docs for ${package_name || variant || 'all'} with refresh mode: ${
						refreshMode || 'DEFAULT'
					}`,
				);
				await fetch_docs(
					package_name ?? undefined,
					variant ?? undefined,
				);
			}

			const result = await db.execute({
				sql: `SELECT content FROM docs
                  WHERE (package = ? OR package IS NULL)
                    AND (variant = ? OR variant IS NULL)
                  LIMIT 1`,
				args: [package_name, variant],
			});

			if (result.rows.length === 0) {
				return {
					contents: [],
					isError: true,
					content: [
						{
							type: 'text',
							text: `Documentation not found for URI: ${uri}`,
						},
					],
				};
			}

			const docText = String(result.rows[0].content);
			const resourceContent: ResourceContents = {
				uri,
				text: docText,
				mimeType: 'text/plain',
			};

			return {
				contents: [resourceContent],
				isError: false,
			};
		} catch (error) {
			return {
				contents: [],
				isError: true,
				content: [
					{
						type: 'text',
						text: `Error reading resource: ${
							error instanceof Error ? error.message : String(error)
						}`,
					},
				],
			};
		}
	},
);

// ------------------------------------------------------------
// 7) Server Startup & Background Initialization
// ------------------------------------------------------------
async function runServer() {
	try {
		const transport = new StdioServerTransport();
		await server.connect(transport);
		console.error('Svelte Docs MCP Server running on stdio');

		// Initialize DB & docs in background
		(async () => {
			try {
				const timeoutId = setTimeout(() => {
					console.error(
						'Database initialization still in progress after 5 seconds',
					);
				}, 5000);

				let dbReady = false;
				try {
					dbReady = await verify_db();
					if (dbReady) {
						console.error('Database is already verified');
						clearTimeout(timeoutId);
						return;
					}
				} catch (verifyError) {
					console.error(
						'Database verification failed; will try to init:',
						verifyError,
					);
				}

				try {
					const dbCheck = await db.execute(
						"SELECT name FROM sqlite_master WHERE type='table' AND name='docs'",
					);
					if (dbCheck.rows.length === 0) {
						await init_db();
					}
				} catch (schemaError) {
					console.error('Error checking DB schema:', schemaError);
					await init_db();
				}

				await init_docs();
				dbReady = await verify_db();
				if (!dbReady) {
					console.error(
						'WARNING: Database verification still failing after init.',
					);
				} else {
					console.error('Database initialized & verified');
				}
				clearTimeout(timeoutId);
			} catch (err) {
				console.error('Error during background init:', err);
				// Keep server running anyway
			}
		})();
	} catch (error) {
		console.error('Fatal error during server initialization:', error);
		process.exit(1);
	}
}

process.on('SIGINT', async () => {
	console.error('Received SIGINT, shutting down...');
	await server.close();
	process.exit(0);
});

process.on('SIGTERM', async () => {
	console.error('Received SIGTERM, shutting down...');
	await server.close();
	process.exit(0);
});

runServer().catch((error) => {
	console.error('Fatal error running server:', error);
	process.exit(1);
});
