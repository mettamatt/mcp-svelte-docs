import { createClient } from '@libsql/client';

export const db = createClient({
	url: process.env.LIBSQL_URL || 'file:./svelte-docs.db',
});

export const verify_db = async () => {
	try {
		const result = await db.execute(
			'SELECT COUNT(*) as count FROM docs',
		);
		const count = result.rows[0].count;
		if (count === 0) {
			console.error(
				'Warning: Database appears to be empty, triggering docs fetch',
			);
			// Don't throw an error, just return false to indicate verification failed
			return false;
		}
		console.error(`Database populated with ${count} documents`);
		return true;
	} catch (error) {
		console.error('Error verifying database:', error);
		return false;
	}
};

export const init_db = async () => {
	try {
		// Use a transaction to ensure database consistency
		await db.execute('BEGIN TRANSACTION');

		// Drop existing tables and their data
		await db.execute(`DROP TABLE IF EXISTS search_index;`);
		await db.execute(`DROP TABLE IF EXISTS docs;`);

		// Create tables with proper constraints
		await db.execute(`
    CREATE TABLE docs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      package TEXT,
      variant TEXT,
      content TEXT NOT NULL,
      hierarchy TEXT,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

		await db.execute(`
    CREATE TABLE search_index (
      doc_id TEXT NOT NULL,
      term TEXT NOT NULL,
      frequency INTEGER NOT NULL,
      section_importance REAL NOT NULL,
      FOREIGN KEY (doc_id) REFERENCES docs(id),
      PRIMARY KEY (doc_id, term)
    );
  `);

		// Add indexes for better search performance
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_search_term ON search_index(term);`,
		);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_docs_package ON docs(package);`,
		);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_docs_variant ON docs(variant);`,
		);
		await db.execute(
			`CREATE INDEX IF NOT EXISTS idx_docs_type ON docs(type);`,
		);

		// Commit the transaction
		await db.execute('COMMIT');
		console.error('Successfully initialized database schema');
	} catch (error) {
		// Roll back the transaction if anything fails
		await db.execute('ROLLBACK').catch(() => {});
		console.error('Failed to initialize database schema:', error);
		throw error;
	}
};
