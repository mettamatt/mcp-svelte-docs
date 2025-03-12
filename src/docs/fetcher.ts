import { db } from '../db/client.js';

const BASE_URL = 'https://svelte.dev';

// Root level docs
const ROOT_DOCS = {
	'llms.txt': `${BASE_URL}/llms.txt`,
	'llms-full.txt': `${BASE_URL}/llms-full.txt`,
	'llms-small.txt': `${BASE_URL}/llms-small.txt`,
};

// Package level docs
const PACKAGE_DOCS = {
	svelte: `${BASE_URL}/docs/svelte/llms.txt`,
	kit: `${BASE_URL}/docs/kit/llms.txt`,
	cli: `${BASE_URL}/docs/cli/llms.txt`,
};

// Default update interval (24 hours)
const DAILY_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const WEEKLY_UPDATE_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 7 days

// Default to daily updates
let UPDATE_INTERVAL = DAILY_UPDATE_INTERVAL;
let REFRESH_MODE: 'DAILY' | 'WEEKLY' = 'DAILY';

/**
 * Set the refresh mode for documentation updates
 * @param mode 'DAILY' or 'WEEKLY'
 */
export const setRefreshMode = (mode: 'DAILY' | 'WEEKLY') => {
	REFRESH_MODE = mode;
	UPDATE_INTERVAL =
		mode === 'WEEKLY'
			? WEEKLY_UPDATE_INTERVAL
			: DAILY_UPDATE_INTERVAL;
	console.error(
		`Documentation refresh interval set to ${mode} (${UPDATE_INTERVAL / (1000 * 60 * 60)} hours)`,
	);
};

export type DocType = 'api' | 'tutorial' | 'example' | 'error';
export type Package = 'svelte' | 'kit' | 'cli';
export type DocVariant = 'llms' | 'llms-full' | 'llms-small';

interface DocMetadata {
	id: string;
	type: DocType;
	package?: Package;
	variant?: DocVariant;
	hierarchy?: string;
}

export const init_docs = async () => {
	console.error('Starting docs initialization...');
	try {
		// Check if docs already exist
		const docCount = await db.execute(
			'SELECT COUNT(*) as count FROM docs',
		);
		const count = Number(docCount.rows[0].count);
		if (count > 0) {
			console.error(
				`Found ${count} existing documents, skipping initial fetch`,
			);
			return;
		}

		// If no docs exist, fetch them
		console.error('No existing docs found, initializing...');

		// Clear any partial data
		await db.execute('DELETE FROM search_index');
		await db.execute('DELETE FROM docs');

		// Package docs are required - fetch them concurrently for speed
		const package_results = await Promise.all(
			Object.keys(PACKAGE_DOCS).map((pkg) =>
				fetch_docs(pkg as Package),
			),
		);

		if (package_results.some((r) => !r || r.length === 0)) {
			throw new Error(
				'Failed to fetch required package documentation',
			);
		}
		console.error('Successfully fetched package documentation');

		// Try root docs but don't fail if they're not available
		try {
			await Promise.all(
				Object.entries(ROOT_DOCS).map(([variant, _url]) =>
					fetch_docs(
						undefined,
						variant.replace('.txt', '') as DocVariant,
					),
				),
			);
			console.error('Successfully fetched root documentation');
		} catch (error) {
			console.error('Optional root docs not available:', error);
		}

		console.error('Successfully initialized all documentation');
	} catch (error) {
		console.error('Failed to initialize docs:', error);
		throw error;
	}
};

export const fetch_docs = async (
	package_name?: Package,
	variant?: DocVariant,
) => {
	let url: string;

	if (package_name) {
		url = PACKAGE_DOCS[package_name];
	} else if (variant) {
		url = ROOT_DOCS[`${variant}.txt`];
	} else {
		url = ROOT_DOCS['llms.txt'];
	}

	const start = Date.now();
	try {
		// Network fetch timing
		const fetch_start = Date.now();
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch docs: ${response.statusText} (${response.status})`,
			);
		}
		const content = await response.text();
		console.error(
			`Fetch took ${Date.now() - fetch_start}ms for ${url}`,
		);

		// Processing timing
		const process_start = Date.now();
		const result = await process_docs(content, package_name, variant);
		console.error(
			`Processing took ${Date.now() - process_start}ms for ${url}`,
		);

		console.error(
			`Total operation took ${Date.now() - start}ms for ${url}`,
		);
		return result;
	} catch (error) {
		console.error(
			`Error fetching docs for ${package_name || variant}:`,
			error,
		);
		return [];
	}
};

const process_docs = async (
	content: string,
	package_name?: Package,
	variant?: DocVariant,
) => {
	console.error(
		`Processing docs for ${package_name || variant || 'root'}`,
	);
	const sections = content.split('\n\n');
	const processed_docs: Array<DocMetadata & { content: string }> = [];
	const index_operations: Array<{
		id: string;
		content: string;
		weight: number;
		terms: Array<{ term: string; frequency: number }>;
	}> = [];

	let current_type: DocType = 'api';
	let current_hierarchy: string[] = [];

	try {
		// First pass - collect docs and prepare index data
		for (const section of sections) {
			if (section.startsWith('# ')) {
				current_hierarchy = [section.substring(2)];
				// Detect doc type from heading
				const lower = section.toLowerCase();
				if (lower.includes('api')) current_type = 'api';
				else if (lower.includes('tutorial'))
					current_type = 'tutorial';
				else if (lower.includes('example')) current_type = 'example';
				else if (lower.includes('error')) current_type = 'error';
			} else if (section.startsWith('## ')) {
				current_hierarchy = [
					current_hierarchy[0],
					section.substring(3),
				];
			} else if (section.trim()) {
				const id_parts = [];
				if (package_name) id_parts.push(package_name);
				if (variant) id_parts.push(variant);
				id_parts.push(
					...current_hierarchy.map((h) => h?.toLowerCase() || ''),
				);

				const doc = {
					id: id_parts.join('-'),
					type: current_type,
					package: package_name,
					variant,
					hierarchy: JSON.stringify(current_hierarchy),
					content: section,
				};

				processed_docs.push(doc);

				// Prepare index data
				// First extract special terms like $state, $derived, etc.
				const specialTerms: Record<string, number> = {};
				const specialPattern = /\$[a-zA-Z][a-zA-Z0-9_]*/g;
				let specialMatch;
				while (
					(specialMatch = specialPattern.exec(
						section.toLowerCase(),
					)) !== null
				) {
					const term = specialMatch[0];
					specialTerms[term] = (specialTerms[term] || 0) + 1;
				}

				// Then extract normal terms
				const normalTerms = section
					.toLowerCase()
					.split(/\W+/)
					.filter((term) => term.length > 2)
					.reduce(
						(acc, term) => {
							acc[term] = (acc[term] || 0) + 1;
							return acc;
						},
						{} as Record<string, number>,
					);

				// Combine both sets of terms
				const terms = { ...normalTerms, ...specialTerms };

				index_operations.push({
					id: doc.id,
					content: doc.content,
					weight: current_hierarchy.length === 1 ? 2.0 : 1.0,
					terms: Object.entries(terms).map(([term, frequency]) => ({
						term,
						frequency,
					})),
				});
			}
		}

		if (processed_docs.length === 0) {
			console.error('No documents processed');
			return [];
		}
		console.error(`Processed ${processed_docs.length} documents`);

		// Process in batches
		const batch_size = 500;
		for (let i = 0; i < processed_docs.length; i += batch_size) {
			const batch_docs = processed_docs.slice(i, i + batch_size);
			const batch_ops = index_operations.slice(i, i + batch_size);

			await db.execute('BEGIN TRANSACTION');
			try {
				// Batch insert for docs
				if (batch_docs.length > 0) {
					const placeholders = batch_docs
						.map(() => '(?, ?, ?, ?, ?, ?)')
						.join(',');
					const values = batch_docs.flatMap((doc) => [
						doc.id,
						doc.type,
						doc.package || null,
						doc.variant || null,
						doc.content,
						doc.hierarchy || null,
					]);

					await db.execute({
						sql: `INSERT OR REPLACE INTO docs 
                  (id, type, package, variant, content, hierarchy) 
                  VALUES ${placeholders}`,
						args: values,
					});
				}

				// Process search index in smaller sub-batches
				const index_batch_size = 100;
				for (let j = 0; j < batch_ops.length; j += index_batch_size) {
					const index_batch = batch_ops.slice(
						j,
						j + index_batch_size,
					);
					for (const op of index_batch) {
						if (op.terms.length === 0) continue;
						const term_placeholders = op.terms
							.map(() => '(?, ?, ?, ?)')
							.join(',');
						const term_values = op.terms.flatMap(
							({ term, frequency }) => [
								op.id,
								term,
								frequency,
								op.weight,
							],
						);

						await db.execute({
							sql: `INSERT OR REPLACE INTO search_index 
                    (doc_id, term, frequency, section_importance) 
                    VALUES ${term_placeholders}`,
							args: term_values,
						});
					}
				}

				await db.execute('COMMIT');
				console.error(
					`Processed batch ${Math.floor(i / batch_size) + 1} of ${Math.ceil(
						processed_docs.length / batch_size,
					)}`,
				);
			} catch (error) {
				console.error(
					'Error during batch processing, rolling back:',
					error,
				);
				await db.execute('ROLLBACK');
				throw error;
			}
		}

		return processed_docs;
	} catch (error) {
		console.error('Error processing docs:', error);
		throw error;
	}
};

/**
 * Check if documentation should be updated based on the refresh mode
 * @param package_name Optional package name to check
 * @param variant Optional doc variant to check
 * @param forceRefresh Force refresh regardless of last update time
 * @returns True if docs should be updated, false otherwise
 */
export const should_update_docs = async (
	package_name?: Package,
	variant?: DocVariant,
	forceRefresh: boolean = false,
): Promise<boolean> => {
	// If force refresh is requested, skip time check
	if (forceRefresh) {
		console.error(
			`Forced refresh requested for ${package_name || variant || 'all'} docs`,
		);
		return true;
	}

	const result = await db.execute({
		sql: `SELECT last_updated FROM docs 
          WHERE (package = ? OR package IS NULL) 
            AND (variant = ? OR variant IS NULL)
          ORDER BY last_updated DESC 
          LIMIT 1`,
		args: [package_name || null, variant || null],
	});

	if (result.rows.length === 0) return true;

	const last_updated = new Date(
		result.rows[0].last_updated as string,
	);
	const timeSinceUpdate = Date.now() - last_updated.getTime();
	const shouldUpdate = timeSinceUpdate > UPDATE_INTERVAL;

	if (shouldUpdate) {
		console.error(
			`Update needed for ${package_name || variant || 'docs'}: ${Math.round(timeSinceUpdate / (1000 * 60 * 60))} hours since last update (refresh interval: ${Math.round(UPDATE_INTERVAL / (1000 * 60 * 60))} hours)`,
		);
	}

	return shouldUpdate;
};

export const get_doc_resources = async () => {
	// Return the available documentation resources with the correct scheme
	return {
		resources: [
			// Root level docs
			{
				uri: 'svelte-docs://docs/llms.txt',
				name: 'Svelte Documentation (Standard)',
				description:
					'Standard documentation covering Svelte core concepts and features',
				mimeType: 'text/plain',
			},
			{
				uri: 'svelte-docs://docs/llms-full.txt',
				name: 'Svelte Documentation (Full)',
				description:
					'Comprehensive documentation including advanced topics and detailed examples',
				mimeType: 'text/plain',
			},
			{
				uri: 'svelte-docs://docs/llms-small.txt',
				name: 'Svelte Documentation (Concise)',
				description:
					'Condensed documentation focusing on essential concepts',
				mimeType: 'text/plain',
			},
			// Package docs
			{
				uri: 'svelte-docs://docs/svelte/llms.txt',
				name: 'Svelte Core Documentation',
				description:
					'Documentation specific to Svelte core library features and APIs',
				mimeType: 'text/plain',
			},
			{
				uri: 'svelte-docs://docs/kit/llms.txt',
				name: 'SvelteKit Documentation',
				description:
					'Documentation for SvelteKit application framework and routing',
				mimeType: 'text/plain',
			},
			{
				uri: 'svelte-docs://docs/cli/llms.txt',
				name: 'Svelte CLI Documentation',
				description:
					'Documentation for Svelte command-line tools and utilities',
				mimeType: 'text/plain',
			},
		],
	};
};
