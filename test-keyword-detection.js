// Simple test script for keyword detection
import { TERM_WEIGHTS } from './dist/search/index.js';

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
function isSvelteQuery(query) {
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
	if (queryTerms.some((term) => CONTEXT_REQUIRED_TERMS.has(term))) {
		for (const term of queryTerms) {
			// Must be at least one other Svelte term
			if (term in TERM_WEIGHTS && !CONTEXT_REQUIRED_TERMS.has(term)) {
				return true;
			}
		}
	}

	return false;
}

// Test queries
const TEST_QUERIES = [
	{
		query: 'How do I use svelte?',
		expected: true,
		reason: "Contains 'svelte'",
	},
	{
		query: 'What is $state in Svelte 5?',
		expected: true,
		reason: "Contains 'svelte' and '$state'",
	},
	{
		query: 'How do I handle component lifecycle?',
		expected: true,
		reason: "Contains 'component' and 'lifecycle'",
	},
	{
		query: 'What are runes?',
		expected: true,
		reason: "Contains 'runes'",
	},
	{
		query: 'How to use SvelteKit routing?',
		expected: true,
		reason: "Contains 'sveltekit' and 'routing'",
	},
	{
		query: "What's the best way to handle state management?",
		expected: true,
		reason: "Contains 'state'",
	},
	{
		query: 'How do I fix this error?',
		expected: false,
		reason: "Contains 'error' but no Svelte context",
	},
	{
		query: 'Svelte error handling',
		expected: true,
		reason: "Contains 'error' with 'svelte' context",
	},
	{
		query: 'How to debug JavaScript?',
		expected: false,
		reason: "Contains 'debug' but no Svelte context",
	},
	{
		query: 'How to debug Svelte components?',
		expected: true,
		reason: "Contains 'debug' with 'svelte' context",
	},
	{
		query: 'Pizza recipes',
		expected: false,
		reason: 'No Svelte terms',
	},
	{
		query: 'Best store implementation',
		expected: false,
		reason: "Contains 'store' but no Svelte context",
	},
	{
		query: 'Svelte store patterns',
		expected: true,
		reason: "Contains 'store' with 'svelte' context",
	},
	{
		query: 'load function in JavaScript',
		expected: false,
		reason: "Contains 'load' but no Svelte context",
	},
	{
		query: 'load function in SvelteKit',
		expected: true,
		reason: "Contains 'load' with 'sveltekit' context",
	},
];

// Run tests
console.log('Running keyword detection tests...\n');

let passed = 0;
let failed = 0;

for (const test of TEST_QUERIES) {
	const result = isSvelteQuery(test.query);
	const status = result === test.expected ? 'PASS' : 'FAIL';

	if (status === 'PASS') {
		passed++;
	} else {
		failed++;
	}

	console.log(`[${status}] "${test.query}"`);
	if (status === 'FAIL') {
		console.log(`       Expected: ${test.expected}, Got: ${result}`);
		console.log(`       Reason: ${test.reason}`);
	}
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
