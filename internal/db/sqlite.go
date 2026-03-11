package db

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

// SQLiteDB wraps a connection to a Spin SQLite database file.
type SQLiteDB struct {
	db *sql.DB
}

// OpenSQLite opens the Spin SQLite database at the given path with WAL mode
// and a busy timeout to avoid locking conflicts with the running spin process.
func OpenSQLite(path string) (*SQLiteDB, error) {
	dsn := fmt.Sprintf("file:%s?_journal_mode=WAL&_busy_timeout=5000", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening sqlite db: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("pinging sqlite db: %w", err)
	}
	return &SQLiteDB{db: db}, nil
}

// Close closes the underlying database connection.
func (s *SQLiteDB) Close() error {
	return s.db.Close()
}

// Tables returns the names of all user-defined tables (excluding sqlite_ internals).
func (s *SQLiteDB) Tables() ([]string, error) {
	rows, err := s.db.Query(
		`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tables = append(tables, name)
	}
	return tables, rows.Err()
}

// QueryResult holds the column names and rows returned by a query.
type QueryResult struct {
	Columns []string        `json:"columns"`
	Rows    [][]interface{} `json:"rows"`
}

// Query executes a read-only SQL statement and returns the results.
// Only SELECT statements are allowed; any other statement returns an error.
func (s *SQLiteDB) Query(sql string) (*QueryResult, error) {
	trimmed := strings.TrimSpace(strings.ToUpper(sql))
	if !strings.HasPrefix(trimmed, "SELECT") && !strings.HasPrefix(trimmed, "WITH") && !strings.HasPrefix(trimmed, "EXPLAIN") {
		return nil, fmt.Errorf("only SELECT / WITH / EXPLAIN statements are allowed in query mode")
	}
	return s.execQuery(sql)
}

// Exec executes an arbitrary SQL statement (INSERT, UPDATE, DELETE, etc.).
func (s *SQLiteDB) Exec(statement string) (*QueryResult, error) {
	trimmed := strings.TrimSpace(strings.ToUpper(statement))
	if strings.HasPrefix(trimmed, "DROP") || strings.HasPrefix(trimmed, "TRUNCATE") {
		return nil, fmt.Errorf("DROP and TRUNCATE are not permitted via the dashboard")
	}
	// For write statements that return no rows, use db.Exec directly.
	if !strings.HasPrefix(trimmed, "SELECT") {
		res, err := s.db.Exec(statement)
		if err != nil {
			return nil, err
		}
		affected, _ := res.RowsAffected()
		return &QueryResult{
			Columns: []string{"rows_affected"},
			Rows:    [][]interface{}{{affected}},
		}, nil
	}
	return s.execQuery(statement)
}

func (s *SQLiteDB) execQuery(query string) (*QueryResult, error) {
	rows, err := s.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	var result [][]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		// Convert []byte → string for JSON readability.
		row := make([]interface{}, len(cols))
		for i, v := range vals {
			if b, ok := v.([]byte); ok {
				row[i] = string(b)
			} else {
				row[i] = v
			}
		}
		result = append(result, row)
	}
	return &QueryResult{Columns: cols, Rows: result}, rows.Err()
}
