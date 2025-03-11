#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	ListPromptsRequestSchema,
	GetPromptRequestSchema,
	Tool,
	ResourceContents,
	Prompt,
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
import { search_docs } from './search/index.js';

// Parse command line arguments
const args = process.argv.slice(2);
let refreshMode: 'DAILY' | 'WEEKLY' | undefined;

// Simple argument parsing
for (let i = 0; i < args.length; i++) {
	const arg = args[i].toUpperCase();
	if (arg === '--REFRESH' || arg === '--REFRESH=DAILY') {
		refreshMode = 'DAILY';
	} else if (arg === '--REFRESH=WEEKLY') {
		refreshMode = 'WEEKLY';
	}
}

// Set refresh mode if provided
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
// 1) Create the modern MCP Server instance
// ------------------------------------------------------------
const server = new Server(
	{ name, version },
	{
		// Enable or customize capabilities
		capabilities: {
			tools: {},
			resources: {},
			prompts: {}, // Enabled prompts capability
		},
	},
);

// ------------------------------------------------------------
// 2) Define Tools (as plain objects)
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
// 3) Define Prompts
// ------------------------------------------------------------
const SVELTE_DOCS_PROMPT: Prompt = {
	name: 'svelte_docs_overview',
	description: 'Get an overview of Svelte documentation',
	arguments: [
		{
			name: 'package',
			description:
				'The package to get documentation for (svelte, kit, or cli)',
			type: 'string',
			enum: ['svelte', 'kit', 'cli'],
			required: false,
		},
	],
};

const SVELTE_QUICK_SEARCH_PROMPT: Prompt = {
	name: 'svelte_quick_search',
	description:
		'Quickly search Svelte documentation for a specific term',
	arguments: [
		{
			name: 'query',
			description: 'The term to search for',
			type: 'string',
			required: true,
		},
	],
};

// ------------------------------------------------------------
// 4) List Tools
// ------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => {
	return {
		tools: [SVELTE_SEARCH_DOCS_TOOL, SVELTE_GET_NEXT_CHUNK_TOOL],
	};
});

// ------------------------------------------------------------
// 5) List Prompts
// ------------------------------------------------------------
server.setRequestHandler(ListPromptsRequestSchema, async () => {
	return {
		prompts: [SVELTE_DOCS_PROMPT, SVELTE_QUICK_SEARCH_PROMPT],
	};
});

// ------------------------------------------------------------
// 6) Get Prompt
// ------------------------------------------------------------
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
	const { name, arguments: promptArgs } = request.params;

	switch (name) {
		case 'svelte_docs_overview': {
			const packageName = promptArgs?.package || 'svelte';
			let overview = `# ${packageName.toUpperCase()} Documentation Overview\n\n`;

			// Get overview information from the database or generate it
			// This is a placeholder - you would likely implement real logic here
			if (packageName === 'svelte') {
				overview +=
					'Svelte is a new approach to building user interfaces. ' +
					'Whereas traditional frameworks like React and Vue do the bulk of their work in the browser, ' +
					'Svelte shifts that work into a compile step that happens when you build your app.\n\n' +
					'Key sections of Svelte documentation include:\n' +
					'- Tutorial: Interactive lessons to learn Svelte\n' +
					'- API Documentation: Complete reference\n' +
					'- Examples: Practical demonstrations\n' +
					'- FAQ: Common questions and answers';
			} else if (packageName === 'kit') {
				overview +=
					'SvelteKit is a framework for building web applications of all sizes, ' +
					'with a beautiful development experience and flexible filesystem-based routing.\n\n' +
					'Key sections of SvelteKit documentation include:\n' +
					'- Getting Started: Setup instructions\n' +
					'- Routing: Page and API routes\n' +
					'- Loading Data: Server and client data fetching\n' +
					'- Forms: Progressive enhancement\n' +
					'- Deployment: Building and hosting';
			} else if (packageName === 'cli') {
				overview +=
					'The Svelte CLI provides tools for creating new projects, ' +
					'managing dependencies, and preparing for production deployment.\n\n' +
					'Key commands include:\n' +
					'- create: Initialize a new project\n' +
					'- dev: Start development server\n' +
					'- build: Create production build\n' +
					'- preview: Preview production build';
			}

			return {
				messages: [
					{
						role: 'assistant',
						content: {
							type: 'text',
							text: overview,
						},
					},
				],
			};
		}

		case 'svelte_quick_search': {
			if (!promptArgs?.query) {
				return {
					isError: true,
					error: 'Query parameter is required',
					messages: [],
				};
			}

			// Use the existing search_docs function to get results
			const { results } = await search_docs({
				query: promptArgs.query,
				doc_type: 'all',
				context: 1,
				include_hierarchy: true,
			});

			if (results.length === 0) {
				return {
					messages: [
						{
							role: 'assistant',
							content: {
								type: 'text',
								text: `No results found for "${promptArgs.query}". Try a different search term.`,
							},
						},
					],
				};
			}

			// Format the top 3 results (or fewer if less are available)
			const topResults = results.slice(0, 3);
			let responseText = `# Quick Search Results for "${promptArgs.query}"\n\n`;

			topResults.forEach((result, idx) => {
				responseText += `## Result ${idx + 1}\n`;
				if (result.hierarchy) {
					responseText += `**Path:** ${result.hierarchy.join(' > ')}\n\n`;
				}
				responseText += `**Type:** ${result.type} | **Package:** ${result.package || 'core'}\n\n`;
				responseText += `${result.content}\n\n`;
			});

			responseText += `\nFound ${results.length} total results. Use the \`svelte_search_docs\` tool for more detailed searching.`;

			return {
				messages: [
					{
						role: 'assistant',
						content: {
							type: 'text',
							text: responseText,
						},
					},
				],
			};
		}

		default:
			return {
				isError: true,
				error: `Unknown prompt: ${name}`,
				messages: [],
			};
	}
});

// ------------------------------------------------------------
// 7) Call Tool (the switch logic for each tool)
// ------------------------------------------------------------
// Import TERM_WEIGHTS from search module
import { TERM_WEIGHTS } from './search/index.js';

// Define the keywords that should have additional context to trigger Svelte docs
// These are more generic terms that need to be paired with another Svelte term
const CONTEXT_REQUIRED_TERMS = new Set([
	'error',
	'warning',
	'debug',
	'store',
	'load',
	'action',
]);

// Additional strong Svelte indicators not in TERM_WEIGHTS
const ADDITIONAL_SVELTE_TERMS = new Set([
	'svelte',
	'sveltekit',
	'svelte.js',
	'runes',
	'state',
]);

// Helper to detect if a query might be Svelte-related
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

		// If we have a direct match with a TERM_WEIGHTS key
		if (term in TERM_WEIGHTS) {
			// If this is a term requiring context, we need to look for another match
			if (CONTEXT_REQUIRED_TERMS.has(term)) {
				continue; // Skip counting this as a direct match
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
			// Must be at least one other Svelte term
			if (term in TERM_WEIGHTS && !CONTEXT_REQUIRED_TERMS.has(term)) {
				return true;
			}
		}
	}

	return false;
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name: toolName, arguments: toolArgs } = request.params;

	// Basic guard
	if (!toolArgs) {
		return {
			content: [
				{ type: 'text', text: 'No tool arguments provided.' },
			],
			isError: true,
			error: 'No tool arguments provided.',
		};
	}

	try {
		// Auto-detect Svelte queries even when another tool is called
		if (
			toolName !== 'svelte_search_docs' &&
			'query' in toolArgs &&
			typeof toolArgs.query === 'string' &&
			// Fast check first - only proceed if query contains "svelte" to save time
			toolArgs.query.toLowerCase().includes('svelte') &&
			isSvelteQuery(toolArgs.query)
		) {
			console.error(
				`Detected Svelte-related query in ${toolName}: ${toolArgs.query}`,
			);

			// Don't search yet, just notify that this is a Svelte query
			return {
				content: [
					{
						type: 'text',
						text: `This query appears to be related to Svelte. For detailed information, you can use the 'svelte_search_docs' tool with the query: "${toolArgs.query}"`,
					},
				],
			};
		}

		switch (toolName) {
			// ~~~~~~~~~~~~~
			// svelte_search_docs
			// ~~~~~~~~~~~~~
			case 'svelte_search_docs': {
				// Validate with Zod for safety
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
					return { content: [{ type: 'text', text: notFound }] };
				}

				// Format
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

				return { content: [{ type: 'text', text: response }] };
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
						error: `Invalid URI: ${args.uri}`,
					};
				}

				// Derive package_name / variant from the path
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
							error: `Invalid doc variant: ${path}`,
						};
					}
				}

				// DB query
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
						error: 'No more chunks available',
					};
				}

				return {
					content: [
						{ type: 'text', text: String(result.rows[0].content) },
					],
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
					error: `Unknown tool: ${toolName}`,
				};
		}
	} catch (err) {
		return {
			content: [
				{
					type: 'text',
					text: `Error running tool "${toolName}": ${
						err instanceof Error ? err.message : String(err)
					}`,
				},
			],
			isError: true,
			error: `Error running tool "${toolName}": ${
				err instanceof Error ? err.message : String(err)
			}`,
		};
	}
});

// ------------------------------------------------------------
// 8) Resources Handlers (ListResources & ResourceRequest)
// ------------------------------------------------------------
server.setRequestHandler(ListResourcesRequestSchema, async () => {
	return await get_doc_resources();
});

server.setRequestHandler(
	ReadResourceRequestSchema,
	async (request) => {
		const { uri } = request.params;

		if (!uri.startsWith('svelte-docs://docs/')) {
			return {
				contents: [],
				isError: true,
				error: `Unrecognized URI: ${uri}`,
			};
		}

		// Determine if it's a package or a variant
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

		// Check if we need to update docs based on refresh mode
		// If refresh mode is set, we use it to determine if we should force a refresh
		const forceRefresh = refreshMode !== undefined;
		if (
			await should_update_docs(
				package_name ?? undefined,
				variant ?? undefined,
				forceRefresh,
			)
		) {
			console.error(
				`Updating docs for ${package_name || variant || 'all'} with refresh mode: ${refreshMode || 'DEFAULT'}`,
			);
			await fetch_docs(
				package_name ?? undefined,
				variant ?? undefined,
			);
		}

		// Grab the doc from the DB
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
				error: `Documentation not found for URI: ${uri}`,
			};
		}

		const docText = String(result.rows[0].content);

		const resourceContent: ResourceContents = {
			uri,
			text: docText,
			mimeType: 'text/plain',
		};

		return { contents: [resourceContent] };
	},
);

// ------------------------------------------------------------
// 9) Server Startup & Graceful Shutdown
// ------------------------------------------------------------
async function runServer() {
	try {
		// Start server immediately without waiting for database initialization
		const transport = new StdioServerTransport();
		await server.connect(transport);
		console.error(
			'Svelte Docs MCP Server (modern style) running on stdio',
		);

		// Set a flag to track database ready state
		let dbReady = false;

		// Initialize DB and docs in the background
		(async () => {
			try {
				// Set a timeout to log if initialization is taking too long
				const timeoutId = setTimeout(() => {
					if (!dbReady) {
						console.error(
							'Database initialization still in progress after 5 seconds',
						);
					}
				}, 5000);

				// Try to verify the DB first - if it's already good, we're done
				try {
					dbReady = await verify_db();
					if (dbReady) {
						console.error(
							'Database already initialized and verified',
						);
						clearTimeout(timeoutId);
						return;
					}
				} catch (verifyError) {
					console.error(
						'Database verification failed, will try to initialize:',
						verifyError,
					);
				}

				// Check if we need to create the schema
				try {
					const dbCheck = await db.execute(
						"SELECT name FROM sqlite_master WHERE type='table' AND name='docs'",
					);
					if (dbCheck.rows.length === 0) {
						await init_db();
					}
				} catch (schemaError) {
					console.error(
						'Error checking database schema:',
						schemaError,
					);
					await init_db();
				}

				// Initialize docs
				await init_docs();

				// Verify again
				dbReady = await verify_db();
				if (!dbReady) {
					console.error(
						'WARNING: Database verification still failing after initialization',
					);
				} else {
					console.error(
						'Database successfully initialized and verified',
					);
				}

				clearTimeout(timeoutId);
			} catch (error) {
				console.error(
					'Error during background initialization:',
					error,
				);
				// Even if background init fails, server keeps running
				// This is intentional - so that initial requests can be served
				// while docs are being fetched
			}
		})();
	} catch (error) {
		console.error('Fatal error during server initialization:', error);
		process.exit(1);
	}
}

// Graceful shutdown
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
