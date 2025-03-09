import { db } from '../db/client.js';
import { DocType, Package } from '../docs/fetcher.js';

export interface SearchOptions {
	query: string;
	doc_type?: DocType | 'all';
	context?: number;
	include_hierarchy?: boolean;
	package?: Package;
}

export interface SearchResult {
	content: string;
	type: DocType;
	package: Package;
	hierarchy?: string[];
	relevance_score: number;
	category?: 'runes' | 'components' | 'routing' | 'error';
}

export interface RelatedSuggestion {
	term: string;
	relevance: number;
}

// Term importance weights
const TERM_WEIGHTS: Record<string, number> = {
	// Svelte 5 Runes
	runes: 1.5,
	$state: 1.5,
	$derived: 1.5,
	$effect: 1.5,
	$props: 1.5,
	$bindable: 1.5,

	// Core concepts
	lifecycle: 1.3,
	component: 1.3,
	store: 1.3,
	reactive: 1.3,

	// SvelteKit
	sveltekit: 1.4,
	routing: 1.4,
	server: 1.4,
	load: 1.4,
	action: 1.4,

	// Error related
	error: 1.2,
	warning: 1.2,
	debug: 1.2,
};

// Related terms mapping for suggestions
const RELATED_TERMS: Record<string, string[]> = {
	state: ['$state', 'reactive', 'store', 'writable'],
	store: ['writable', 'readable', 'derived', 'state', '$state'],
	props: ['$props', 'component', 'attributes'],
	effect: ['$effect', 'lifecycle', 'onMount', 'onDestroy'],
	derived: ['$derived', 'computed', 'store'],
	route: ['routing', 'navigation', 'params', 'sveltekit'],
	params: ['routing', 'dynamic', 'url', 'query'],
	component: ['custom element', 'lifecycle', 'slot'],
	error: ['debug', 'warning', 'exception', 'handle'],
	action: ['form', 'submit', 'server', 'mutate'],
	bind: ['binding', '$bindable', 'two-way'],
	slot: ['component', 'children', 'content'],
	rune: ['$state', '$derived', '$effect', '$props'],
};

export const search_docs = async ({
	query,
	doc_type = 'all',
	context = 1,
	include_hierarchy = true,
	package: pkg,
}: SearchOptions): Promise<{
	results: SearchResult[];
	related_suggestions?: RelatedSuggestion[];
}> => {
	// Check for exact phrases in quotes
	const exact_phrases: string[] = [];
	const quoted_regex = /"([^"]+)"/g;
	let exact_phrase_match = null;
	const is_phrase_only_query = query.trim().startsWith('"') && query.trim().endsWith('"');

	while ((exact_phrase_match = quoted_regex.exec(query)) !== null) {
		exact_phrases.push(exact_phrase_match[1].toLowerCase());
	}

	// Remove exact phrases from query for term processing
	let term_query = query.replace(quoted_regex, '');

	// Normalize and split query
	const terms = term_query
		.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.split(/\s+/)
		.filter((term) => term.length > 2);

	// Apply term weights
	const weighted_terms = terms.map((term) => ({
		term,
		weight: TERM_WEIGHTS[term] || 1.0,
	}));

	// If we have only exact phrases and no terms, use a direct content search
	if (exact_phrases.length > 0 && terms.length === 0) {
		// Direct phrase search SQL
		let sql = `
      SELECT 
        id,
        content,
        type,
        package,
        hierarchy,
        1.0 as score
      FROM docs
      WHERE 1=1
    `;

		const args: any[] = [];

		// Add phrase conditions
		exact_phrases.forEach((phrase) => {
			sql += ` AND LOWER(content) LIKE ? `;
			args.push(`%${phrase}%`);
		});

		// Add type and package filters
		if (doc_type !== 'all') {
			sql += ' AND type = ?';
			args.push(doc_type);
		}

		if (pkg) {
			sql += ' AND package = ?';
			args.push(pkg);
		}

		// Limit results
		sql += ` LIMIT 10`;

		const results = await db.execute({ sql, args });
		const search_results = results.rows.map((row: any) => ({
			content: row.content,
			type: row.type as DocType,
			package: row.package as Package,
			hierarchy: row.hierarchy ? JSON.parse(row.hierarchy) : undefined,
			relevance_score: 1.0,
			category: determine_category(row.content),
		}));

		// Group by category
		const grouped_results = group_by_category(search_results);
		const related_suggestions = generate_related_suggestions(
			exact_phrases.flatMap(phrase => phrase.split(/\s+/))
		);

		return {
			results: flatten_grouped_results(grouped_results),
			related_suggestions: related_suggestions.length > 0 ? related_suggestions : undefined,
		};
	}

	// Standard search with terms and optional phrases
	let sql = `
    WITH term_matches AS (
      SELECT 
        doc_id,
        SUM(frequency * section_importance * ?) as term_score
      FROM search_index
      WHERE term = ?
      GROUP BY doc_id
    ),
    relevance AS (
      SELECT 
        d.id,
        d.content,
        d.type,
        d.package,
        d.hierarchy,
        COALESCE(tm.term_score, 0) as score
      FROM docs d
      LEFT JOIN term_matches tm ON d.id = tm.doc_id
      WHERE 1=1
  `;

	const args: any[] = weighted_terms.flatMap((t) => [
		t.weight,
		t.term,
	]);

	// Add exact phrase filtering if present
	if (exact_phrases.length > 0) {
		exact_phrases.forEach((phrase) => {
			sql += ` AND LOWER(d.content) LIKE ? `;
			args.push(`%${phrase}%`);
		});
	}

	if (doc_type !== 'all') {
		sql += ' AND d.type = ?';
		args.push(doc_type);
	}

	if (pkg) {
		sql += ' AND d.package = ?';
		args.push(pkg);
	}

	sql += `
      GROUP BY d.id, d.content, d.type, d.package, d.hierarchy
      HAVING score > 0
      ORDER BY score DESC
      LIMIT 10
    )
    SELECT * FROM relevance
  `;

	const results = await db.execute({ sql, args });

	const search_results = results.rows.map((row: any) => ({
		content: row.content,
		type: row.type as DocType,
		package: row.package as Package,
		hierarchy: row.hierarchy ? JSON.parse(row.hierarchy) : undefined,
		relevance_score: row.score,
		category: determine_category(row.content),
	}));

	// Group results by category
	const grouped_results = group_by_category(search_results);

	// Generate related term suggestions
	const related_suggestions = generate_related_suggestions(terms);

	return {
		results: flatten_grouped_results(grouped_results),
		related_suggestions:
			related_suggestions.length > 0
				? related_suggestions
				: undefined,
	};
};

// Helper to determine result category
function determine_category(
	content: string,
): SearchResult['category'] {
	const lower_content = content.toLowerCase();

	if (
		lower_content.includes('rune') ||
		lower_content.includes('$state') ||
		lower_content.includes('$effect')
	) {
		return 'runes';
	}

	if (
		lower_content.includes('component') ||
		lower_content.includes('lifecycle')
	) {
		return 'components';
	}

	if (
		lower_content.includes('route') ||
		lower_content.includes('navigation') ||
		lower_content.includes('sveltekit')
	) {
		return 'routing';
	}

	if (
		lower_content.includes('error') ||
		lower_content.includes('warning') ||
		lower_content.includes('debug')
	) {
		return 'error';
	}

	return undefined;
}

// Generate related search suggestions based on query terms
function generate_related_suggestions(
	terms: string[],
): RelatedSuggestion[] {
	const suggestions: RelatedSuggestion[] = [];
	const seen_terms = new Set<string>();

	// Process each term and find related terms
	terms.forEach((term) => {
		// Skip short terms
		if (term.length <= 2) return;

		// Find directly related terms
		const related = RELATED_TERMS[term] || [];

		// Add related terms with relevance scores
		related.forEach((related_term) => {
			if (
				!terms.includes(related_term) &&
				!seen_terms.has(related_term)
			) {
				seen_terms.add(related_term);
				suggestions.push({
					term: related_term,
					relevance: TERM_WEIGHTS[related_term] || 1.0,
				});
			}
		});

		// Find terms that might be similar based on partial matches
		Object.keys(RELATED_TERMS).forEach((key) => {
			// Check if the key contains our term or vice versa
			if (
				(key.includes(term) || term.includes(key)) &&
				key !== term
			) {
				RELATED_TERMS[key].forEach((related_term) => {
					if (
						!terms.includes(related_term) &&
						!seen_terms.has(related_term)
					) {
						seen_terms.add(related_term);
						// Lower relevance for partial matches
						suggestions.push({
							term: related_term,
							relevance: (TERM_WEIGHTS[related_term] || 1.0) * 0.8,
						});
					}
				});
			}
		});
	});

	// Sort by relevance and limit to top 5
	return suggestions
		.sort((a, b) => b.relevance - a.relevance)
		.slice(0, 5);
}

// Helper function to group results by category
function group_by_category(results: SearchResult[]): Record<string, SearchResult[]> {
	return results.reduce(
		(groups, result) => {
			const category = result.category || 'other';
			if (!groups[category]) {
				groups[category] = [];
			}
			groups[category].push(result);
			return groups;
		},
		{} as Record<string, SearchResult[]>,
	);
}

// Helper function to flatten grouped results
function flatten_grouped_results(grouped_results: Record<string, SearchResult[]>): SearchResult[] {
	return Object.entries(grouped_results)
		.flatMap(([_, results]) => results)
		.sort((a, b) => b.relevance_score - a.relevance_score);
}

export const index_doc_content = async (
	doc_id: string,
	content: string,
	section_importance: number = 1.0,
) => {
	const terms = new Map<string, number>();

	// Extract terms and count frequency
	content
		.toLowerCase()
		.split(/\s+/)
		.forEach((term) => {
			if (term.length > 2) {
				// Skip very short terms
				terms.set(term, (terms.get(term) || 0) + 1);
			}
		});

	// Store in search index
	for (const [term, frequency] of terms.entries()) {
		await db.execute({
			sql: `INSERT OR REPLACE INTO search_index 
            (doc_id, term, frequency, section_importance) 
            VALUES (?, ?, ?, ?)`,
			args: [doc_id, term, frequency, section_importance],
		});
	}
};
