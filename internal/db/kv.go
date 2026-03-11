package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

const kvTable = "_spin_kv"

// KVDB wraps a connection to the Spin KV SQLite database.
type KVDB struct {
	db *sql.DB
}

// KVEntry is a single key-value record with its store name.
type KVEntry struct {
	Store string `json:"store"`
	Key   string `json:"key"`
	Value string `json:"value"`
}

// OpenKV opens the Spin KV store database at the given path.
func OpenKV(path string) (*KVDB, error) {
	dsn := fmt.Sprintf("file:%s?_journal_mode=WAL&_busy_timeout=5000", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening kv db: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("pinging kv db: %w", err)
	}
	return &KVDB{db: db}, nil
}

// Close closes the underlying database connection.
func (k *KVDB) Close() error {
	return k.db.Close()
}

// List returns all entries across all stores, optionally filtered by store name.
func (k *KVDB) List(store string) ([]KVEntry, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if store == "" {
		rows, err = k.db.Query(
			fmt.Sprintf(`SELECT store, key, CAST(value AS TEXT) FROM %s ORDER BY store, key`, kvTable),
		)
	} else {
		rows, err = k.db.Query(
			fmt.Sprintf(`SELECT store, key, CAST(value AS TEXT) FROM %s WHERE store = ? ORDER BY key`, kvTable),
			store,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []KVEntry
	for rows.Next() {
		var e KVEntry
		if err := rows.Scan(&e.Store, &e.Key, &e.Value); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}

// Upsert inserts or replaces a key-value pair in the given store.
func (k *KVDB) Upsert(store, key, value string) error {
	_, err := k.db.Exec(
		fmt.Sprintf(`INSERT OR REPLACE INTO %s (store, key, value) VALUES (?, ?, ?)`, kvTable),
		store, key, []byte(value),
	)
	return err
}

// Delete removes a key from a store. Returns nil if the key did not exist.
func (k *KVDB) Delete(store, key string) error {
	_, err := k.db.Exec(
		fmt.Sprintf(`DELETE FROM %s WHERE store = ? AND key = ?`, kvTable),
		store, key,
	)
	return err
}
