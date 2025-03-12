import { search_docs } from './dist/search/index.js';
import { db } from './dist/db/client.js';

// Problem test cases
const PROBLEM_QUERIES = [
	{ query: '$state', description: 'Basic term query' },
	{
		query: 'component',
		description: 'Doc type filtering',
		doc_type: 'api',
	},
	{
		query: 'routing',
		description: 'Package-specific query',
		package: 'kit',
	},
	{
		query: '"reactive programming"',
		description: 'Exact phrase that should exist in docs',
	},
	{
		query: '"dynamic routes" params',
		description: 'Mixed phrase and term query',
	},
];

async function checkDatabase() {
	console.log('\n=== DATABASE CHECKS ===\n');

	// Check for $state in content
	const stateResult = await db.execute({
		sql: `SELECT COUNT(*) as count FROM docs WHERE LOWER(content) LIKE ?`,
		args: ['%$state%'],
	});
	console.log(
		`Documents containing $state: ${stateResult.rows[0].count}`,
	);

	// Check for component in api docs
	const componentResult = await db.execute({
		sql: `SELECT COUNT(*) as count FROM docs WHERE type = ? AND LOWER(content) LIKE ?`,
		args: ['api', '%component%'],
	});
	console.log(
		`API documents containing component: ${componentResult.rows[0].count}`,
	);

	// Check for routing in kit docs
	const routingResult = await db.execute({
		sql: `SELECT COUNT(*) as count FROM docs WHERE package = ? AND LOWER(content) LIKE ?`,
		args: ['kit', '%routing%'],
	});
	console.log(
		`Kit documents containing routing: ${routingResult.rows[0].count}`,
	);

	// Check for reactive programming in docs
	const reactiveResult = await db.execute({
		sql: `SELECT COUNT(*) as count FROM docs WHERE LOWER(content) LIKE ?`,
		args: ['%reactive programming%'],
	});
	console.log(
		`Documents containing "reactive programming": ${reactiveResult.rows[0].count}`,
	);

	// Check for dynamic routes in docs
	const dynamicResult = await db.execute({
		sql: `SELECT COUNT(*) as count FROM docs WHERE LOWER(content) LIKE ?`,
		args: ['%dynamic routes%'],
	});
	console.log(
		`Documents containing "dynamic routes": ${dynamicResult.rows[0].count}`,
	);

	// Check terms in search_index
	console.log('\n=== SEARCH INDEX CHECKS ===\n');

	const terms = [
		'$state',
		'state',
		'component',
		'routing',
		'reactive',
		'programming',
		'dynamic',
		'routes',
		'params',
	];

	for (const term of terms) {
		const termResult = await db.execute({
			sql: `SELECT COUNT(*) as count FROM search_index WHERE term = ?`,
			args: [term],
		});
		console.log(
			`Term "${term}" in search_index: ${termResult.rows[0].count}`,
		);
	}
}

async function runTests() {
	console.log('Running problem query tests...\n');

	await checkDatabase();

	console.log('\n=== SEARCH FUNCTION TESTS ===\n');

	for (const test of PROBLEM_QUERIES) {
		console.log(`\n=== Test: ${test.description} ===`);
		console.log(`Query: "${test.query}"\n`);

		try {
			// Direct SQL approach for comparison
			console.log('Direct SQL approach:');
			if (test.query === '$state') {
				const directResult = await db.execute({
					sql: `SELECT id, content, type, package FROM docs WHERE LOWER(content) LIKE ? LIMIT 1`,
					args: ['%$state%'],
				});
				console.log(
					`Found: ${directResult.rows.length > 0 ? 'Yes' : 'No'}`,
				);
				if (directResult.rows.length > 0) {
					console.log(`- Type: ${directResult.rows[0].type}`);
					console.log(`- Package: ${directResult.rows[0].package}`);
					console.log(
						`- Preview: ${directResult.rows[0].content.substring(0, 100)}...`,
					);
				}
			}

			// Function approach
			console.log('\nSearch function approach:');
			const start = Date.now();
			const options = {
				query: test.query,
				package: test.package,
				doc_type: test.doc_type || 'all',
			};
			const result = await search_docs(options);
			const duration = Date.now() - start;

			console.log(
				`Found ${result.results.length} results in ${duration}ms`,
			);

			if (result.results.length > 0) {
				console.log('\nTop result:');
				const topResult = result.results[0];
				console.log(`- Type: ${topResult.type}`);
				console.log(`- Package: ${topResult.package}`);
				console.log(`- Category: ${topResult.category || 'none'}`);
				console.log(`- Relevance: ${topResult.relevance_score}`);
				console.log(
					`- Preview: ${topResult.content.substring(0, 100)}...`,
				);
			} else {
				console.log('No results found');
			}

			if (
				result.related_suggestions &&
				result.related_suggestions.length > 0
			) {
				console.log('\nRelated Suggestions:');
				result.related_suggestions.forEach((suggestion) => {
					console.log(
						`- ${suggestion.term} (relevance: ${suggestion.relevance})`,
					);
				});
			}
		} catch (error) {
			console.error(`Error processing query "${test.query}":`, error);
		}
	}
}

runTests().catch(console.error);
