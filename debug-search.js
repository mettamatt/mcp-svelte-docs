import { search_docs } from './dist/search/index.js';

// Test queries
const TEST_QUERIES = [
  { query: '$state', description: 'Basic term query' },
  { query: '"state management"', description: 'Exact phrase query' },
  { query: '"component lifecycle"', description: 'Another exact phrase query' },
  { query: 'routing params', description: 'Multiple term query' },
  { query: 'component lifecycle', description: 'Core concepts query' },
  { query: 'nonexistent term', description: 'Query with no results' },
  { query: '"reactive programming"', description: 'Exact phrase that should exist in docs' },
  { query: 'runes svelte', description: 'Category-specific query' },
  { query: 'routing', description: 'Package-specific query', package: 'kit' },
  { query: '"dynamic routes" params', description: 'Mixed phrase and term query' },
  { query: 'error warning debug', description: 'Multiple weighted terms' },
  { query: 'component', description: 'Doc type filtering', doc_type: 'api' },
  { query: 'error', description: 'Error document search', doc_type: 'error' }
];

async function runTests() {
  console.log('Running search tests...\n');
  
  for (const test of TEST_QUERIES) {
    console.log(`\n=== Test: ${test.description} ===`);
    console.log(`Query: "${test.query}"\n`);
    
    try {
      const start = Date.now();
      const options = { 
        query: test.query,
        package: test.package,
        doc_type: test.doc_type || 'all'
      };
      const result = await search_docs(options);
      const duration = Date.now() - start;
      
      console.log(`Found ${result.results.length} results in ${duration}ms`);
      
      if (result.results.length > 0) {
        console.log('\nTop result:');
        const topResult = result.results[0];
        console.log(`- Type: ${topResult.type}`);
        console.log(`- Package: ${topResult.package}`);
        console.log(`- Category: ${topResult.category || 'none'}`);
        console.log(`- Relevance: ${topResult.relevance_score}`);
        console.log(`- Preview: ${topResult.content.substring(0, 100)}...`);
      } else {
        console.log('No results found');
      }
      
      if (result.related_suggestions && result.related_suggestions.length > 0) {
        console.log('\nRelated Suggestions:');
        result.related_suggestions.forEach(suggestion => {
          console.log(`- ${suggestion.term} (relevance: ${suggestion.relevance})`);
        });
      }
    } catch (error) {
      console.error(`Error processing query "${test.query}":`, error);
    }
  }
}

runTests().catch(console.error);