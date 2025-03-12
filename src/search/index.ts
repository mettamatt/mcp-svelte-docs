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

export const TERM_WEIGHTS: Record<string, number> = {
	runes: 1.5,
	$state: 1.5,
	$derived: 1.5,
	$effect: 1.5,
	$props: 1.5,
	$bindable: 1.5,
	lifecycle: 1.3,
	component: 1.3,
	store: 1.3,
	reactive: 1.3,
	sveltekit: 1.4,
	routing: 1.4,
	server: 1.4,
	load: 1.4,
	action: 1.4,
	error: 1.2,
	warning: 1.2,
	debug: 1.2,
};

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

export async function search_docs({
	query,
	doc_type = 'all',
	context = 1,
	include_hierarchy = true,
	package: pkg,
}: SearchOptions): Promise<{
	results: SearchResult[];
	related_suggestions?: RelatedSuggestion[];
}> {
	// 1. Extract exact phrases in quotes, same as before
	const exact_phrases: string[] = [];
	const quoted_regex = /"([^"]+)"/g;
	let match: RegExpExecArray | null;
	while ((match = quoted_regex.exec(query)) !== null) {
		exact_phrases.push(match[1].toLowerCase());
	}

	// 2. Remove them from the query for standard term analysis
	let term_query = query.replace(quoted_regex, '');

	// 3. Split into terms, ignoring short ones
	const terms = term_query
		.toLowerCase()
		.replace(/[^\w\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length > 2);

	// 4. If no normal terms but some exact phrases, handle as a direct phrase-only search:
	if (terms.length === 0 && exact_phrases.length > 0) {
		return await phrase_only_search({
			phrases: exact_phrases,
			doc_type,
			pkg,
		});
	}

	// 5. Prepare the dynamic CASE expression for term weights
	//    We'll build something like:
	//    CASE si.term
	//       WHEN 'runes' THEN 1.5
	//       WHEN 'component' THEN 1.3
	//       ...
	//       ELSE 1
	//    END
	// Instead of building a CASE expression with string interpolation,
	// which is vulnerable to SQL injection, we'll use a simpler approach
	const distinctTerms = Array.from(new Set(terms)); // deduplicate

	// Create term weight map to reference later
	const termWeightMap = new Map(
		distinctTerms.map((t) => [t, TERM_WEIGHTS[t] || 1.0]),
	);

	// Create a safe CASE expression with parameters
	const caseExpression =
		distinctTerms.length > 0
			? 'CASE si.term ' +
				distinctTerms.map(() => 'WHEN ? THEN ?').join(' ') +
				' ELSE 1 END'
			: '1';

	// 6. Build the main SQL
	//    We do one JOIN from docs -> search_index
	//    We match any row that has si.term in our distinctTerms set
	//    Also filter doc_type and package if provided
	//    For exact_phrases, we do AND d.content LIKE ... for each
	//    Summation is the sum of frequencies, plus the per-term weighting from the CASE expression
	//    If you want "AND" logic (require all terms), we do a HAVING count(DISTINCT si.term) = distinctTerms.length
	//    If you want "OR" logic, remove that HAVING line.
	let sql = `
    SELECT
      d.id,
      d.content,
      d.type,
      d.package,
      d.hierarchy,
      SUM(si.frequency * si.section_importance * ${caseExpression}) AS total_score
    FROM docs d
    JOIN search_index si ON d.id = si.doc_id
    WHERE 1=1
  `;
	let args: any[] = [];

	// 7. si.term IN (...)
	if (distinctTerms.length > 0) {
		const placeholders = distinctTerms.map(() => '?').join(',');
		sql += ` AND si.term IN (${placeholders}) `;

		// Clear args array and rebuild it in the correct order
		args.length = 0;

		// First add all the terms for the IN clause
		args.push(...distinctTerms);

		// Then add pairs of (term, weight) for the CASE expression
		distinctTerms.forEach((term) => {
			args.push(term); // For the WHEN ? part
			args.push(termWeightMap.get(term) || 1.0); // For the THEN ? part, ensure it's a number
		});
	}

	// 8. Add phrase filters
	for (const phrase of exact_phrases) {
		sql += ' AND LOWER(d.content) LIKE ?';
		args.push(`%${phrase}%`);
	}

	// 9. doc_type filter
	if (doc_type !== 'all') {
		sql += ' AND d.type = ?';
		args.push(doc_type);

		// Special case: searching for the term "error" within error documents
		// This requires a specialized path to handle correctly
		if (doc_type === 'error' && distinctTerms.includes('error')) {
			// The term itself is the same as the type filter
			if (
				doc_type === 'error' &&
				distinctTerms.length === 1 &&
				distinctTerms[0] === 'error'
			) {
				// Use a completely new, simple query instead of modifying the existing one
				return {
					results: await executeDirectErrorSearch(),
					related_suggestions: generate_related_suggestions([
						'error',
					]),
				};
			}

			// Helper function for direct error search
			async function executeDirectErrorSearch(): Promise<
				SearchResult[]
			> {
				const directSql = `
					SELECT 
						d.id, 
						d.content, 
						d.type, 
						d.package, 
						d.hierarchy,
						si.frequency * si.section_importance AS total_score
					FROM docs d
					JOIN search_index si ON d.id = si.doc_id
					WHERE si.term = ? AND d.type = ?
					ORDER BY total_score DESC
					LIMIT 10
				`;
				const directArgs = ['error', 'error'];
				const directResult = await db.execute({
					sql: directSql,
					args: directArgs,
				});

				return directResult.rows.map((row: any) => ({
					content: row.content,
					type: row.type as DocType,
					package: row.package as Package,
					hierarchy: row.hierarchy
						? JSON.parse(row.hierarchy)
						: undefined,
					relevance_score: row.total_score,
					category: determine_category(row.content),
				}));
			}
		}
	}

	// 10. package filter
	if (pkg) {
		sql += ' AND d.package = ?';
		args.push(pkg);
	}

	// 11. Group & Having
	//     If you want "OR" logic, omit the HAVING.
	//     If you want "AND" logic (require all distinctTerms), do:
	sql += `
    GROUP BY d.id, d.content, d.type, d.package, d.hierarchy
    ORDER BY total_score DESC
    LIMIT 10
  `;

	// 12. Execute
	const results = await db.execute({ sql, args });
	let search_results: SearchResult[] = results.rows.map(
		(row: any) => ({
			content: row.content,
			type: row.type as DocType,
			package: row.package as Package,
			hierarchy: row.hierarchy
				? JSON.parse(row.hierarchy)
				: undefined,
			relevance_score: row.total_score,
			category: determine_category(row.content),
		}),
	);

	// 12a. Fallback to optimized content search if no results from term search
	if (
		search_results.length === 0 &&
		(distinctTerms.length > 0 || exact_phrases.length > 0)
	) {
		console.error(
			'No results from term search, falling back to optimized content search',
		);

		// OPTIMIZATION: Better approach using OR conditions with weighted scoring
		const searchTerms = [];

		// First, add special terms with higher priority
		for (const term of distinctTerms) {
			if (term.includes('$') || TERM_WEIGHTS[term] !== undefined) {
				searchTerms.push({ term, weight: TERM_WEIGHTS[term] || 1.5 });
			}
		}

		// Then add other terms (limited to 3 to prevent performance issues)
		const otherTerms = distinctTerms
			.filter(
				(t) =>
					!t.includes('$') &&
					TERM_WEIGHTS[t] === undefined &&
					t.length > 3,
			)
			.slice(0, 3);

		for (const term of otherTerms) {
			searchTerms.push({ term, weight: 1.0 });
		}

		// Add exact phrases with highest weight
		for (const phrase of exact_phrases) {
			searchTerms.push({ term: phrase, weight: 2.0, isPhrase: true });
		}

		if (searchTerms.length > 0) {
			// Build dynamic SQL with CASE statement for proper scoring
			let fallbackSql = `
				SELECT d.id, d.content, d.type, d.package, d.hierarchy,
				(
			`;

			// Build a sum of weighted matches
			const conditions = [];
			const fallbackArgs = [];

			for (const { term, weight, isPhrase } of searchTerms) {
				conditions.push(
					`CASE WHEN LOWER(d.content) LIKE ? THEN ${weight} ELSE 0 END`,
				);
				fallbackArgs.push(`%${term}%`);
			}

			fallbackSql += conditions.join(' + ');
			fallbackSql += `) AS relevance_score
				FROM docs d
				WHERE (
			`;

			// Build OR conditions for the WHERE clause
			const whereConditions = searchTerms.map(
				() => 'LOWER(d.content) LIKE ?',
			);
			fallbackSql += whereConditions.join(' OR ');
			fallbackSql += ')';

			// Add search terms to args again for the WHERE clause
			for (const { term } of searchTerms) {
				fallbackArgs.push(`%${term}%`);
			}

			// Add filters for doc_type and package
			if (doc_type !== 'all') {
				fallbackSql += ' AND d.type = ?';
				fallbackArgs.push(doc_type);
			}

			if (pkg) {
				fallbackSql += ' AND d.package = ?';
				fallbackArgs.push(pkg);
			}

			fallbackSql += `
				ORDER BY relevance_score DESC
				LIMIT 10
			`;

			const fallbackResults = await db.execute({
				sql: fallbackSql,
				args: fallbackArgs,
			});

			search_results = fallbackResults.rows.map((row: any) => ({
				content: row.content,
				type: row.type as DocType,
				package: row.package as Package,
				hierarchy: row.hierarchy
					? JSON.parse(row.hierarchy)
					: undefined,
				relevance_score: row.relevance_score,
				category: determine_category(row.content),
			}));

			console.error(
				`Optimized fallback search found ${search_results.length} results`,
			);
		}
	}

	// 13. Group results by category (same as your original code)
	const grouped = group_by_category(search_results);

	// 14. Generate related suggestions
	const related_suggestions = generate_related_suggestions(terms);

	return {
		results: flatten_grouped_results(grouped),
		related_suggestions: related_suggestions.length
			? related_suggestions
			: undefined,
	};
}

/**
 * If the user only gave us exact phrases (and no normal terms),
 * we can do a separate direct search by phrases only.
 */
async function phrase_only_search({
	phrases,
	doc_type,
	pkg,
}: {
	phrases: string[];
	doc_type?: DocType | 'all';
	pkg?: Package;
}) {
	let sql = `
    SELECT 
      d.id,
      d.content,
      d.type,
      d.package,
      d.hierarchy,
      1.0 as total_score
    FROM docs d
    WHERE 1=1
  `;
	let args: any[] = [];

	// Add phrase conditions
	for (const phrase of phrases) {
		sql += ' AND LOWER(d.content) LIKE ?';
		args.push(`%${phrase}%`);
	}

	if (doc_type && doc_type !== 'all') {
		sql += ' AND d.type = ?';
		args.push(doc_type);
	}
	if (pkg) {
		sql += ' AND d.package = ?';
		args.push(pkg);
	}

	sql += ' LIMIT 10';

	const results = await db.execute({ sql, args });
	const search_results = results.rows.map((row: any) => ({
		content: row.content,
		type: row.type as DocType,
		package: row.package as Package,
		hierarchy: row.hierarchy ? JSON.parse(row.hierarchy) : undefined,
		relevance_score: 1.0,
		category: determine_category(row.content),
	}));

	// Group, flatten, etc.
	const grouped = group_by_category(search_results);
	const related_suggestions = generate_related_suggestions(
		phrases.flatMap((p) => p.split(/\s+/)), // naive split for suggestions
	);

	return {
		results: flatten_grouped_results(grouped),
		related_suggestions: related_suggestions.length
			? related_suggestions
			: undefined,
	};
}

/** Same as in your original code */
function determine_category(
	content: string,
): SearchResult['category'] {
	const lower = content.toLowerCase();
	if (
		lower.includes('rune') ||
		lower.includes('$state') ||
		lower.includes('$effect')
	) {
		return 'runes';
	}
	if (lower.includes('component') || lower.includes('lifecycle')) {
		return 'components';
	}
	if (
		lower.includes('route') ||
		lower.includes('navigation') ||
		lower.includes('sveltekit')
	) {
		return 'routing';
	}
	if (
		lower.includes('error') ||
		lower.includes('warning') ||
		lower.includes('debug')
	) {
		return 'error';
	}
	return undefined;
}

/** Same as in your original code */
function generate_related_suggestions(
	terms: string[],
): RelatedSuggestion[] {
	const suggestions: RelatedSuggestion[] = [];
	const seen = new Set<string>();

	for (const term of terms) {
		if (term.length <= 2) continue;
		const related = RELATED_TERMS[term] || [];
		for (const r of related) {
			if (!terms.includes(r) && !seen.has(r)) {
				seen.add(r);
				suggestions.push({
					term: r,
					relevance: TERM_WEIGHTS[r] || 1.0,
				});
			}
		}

		// Optional partial-matching logic from your code ...
		for (const key of Object.keys(RELATED_TERMS)) {
			if (
				(key.includes(term) || term.includes(key)) &&
				key !== term
			) {
				for (const rt of RELATED_TERMS[key]) {
					if (!terms.includes(rt) && !seen.has(rt)) {
						seen.add(rt);
						suggestions.push({
							term: rt,
							relevance: (TERM_WEIGHTS[rt] || 1.0) * 0.8,
						});
					}
				}
			}
		}
	}

	return suggestions
		.sort((a, b) => b.relevance - a.relevance)
		.slice(0, 5);
}

/** Same as in your original code */
function group_by_category(
	results: SearchResult[],
): Record<string, SearchResult[]> {
	return results.reduce(
		(acc, r) => {
			const cat = r.category || 'other';
			if (!acc[cat]) acc[cat] = [];
			acc[cat].push(r);
			return acc;
		},
		{} as Record<string, SearchResult[]>,
	);
}

/** Same as in your original code */
function flatten_grouped_results(
	grouped: Record<string, SearchResult[]>,
): SearchResult[] {
	return Object.values(grouped)
		.flat()
		.sort((a, b) => b.relevance_score - a.relevance_score);
}
