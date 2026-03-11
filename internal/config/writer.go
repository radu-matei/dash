package config

import (
	"fmt"
	"os"
	"strings"
)

// PatchAddVariable inserts a new variable into the [variables] section of
// spin.toml, preserving the existing file content, comments, and formatting.
//
// If required is true, the line is:  name = { required = true }
// Otherwise:                         name = { default = "value" }
// Adding secret = true sets the secret flag in addition.
//
// Returns an error if the variable already exists (duplicate TOML keys are
// invalid and would break spin up).
func PatchAddVariable(dir, name string, required bool, defaultValue string, secret bool) error {
	path := dir + "/spin.toml"
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("reading spin.toml: %w", err)
	}

	// Guard: duplicate key in [variables] is invalid TOML.
	if variableExists(string(content), name) {
		return fmt.Errorf("variable %q already exists in [variables]; edit spin.toml directly to change it", name)
	}

	var parts []string
	if required {
		parts = append(parts, "required = true")
	} else if defaultValue != "" {
		parts = append(parts, fmt.Sprintf("default = %q", defaultValue))
	}
	if secret {
		parts = append(parts, "secret = true")
	}
	var varLine string
	if len(parts) == 0 {
		varLine = name + " = {}"
	} else {
		varLine = name + " = { " + strings.Join(parts, ", ") + " }"
	}

	patched := insertAfterSectionHeader(string(content), "[variables]", varLine)
	return os.WriteFile(path, []byte(patched), 0o644)
}

// PatchAddComponentVariable adds a key = "{{ varName }}" line to
// [component.<id>.variables] in spin.toml, creating the sub-section if absent.
// This wires an application variable so the component can read it via the SDK.
//
// Returns an error if the component doesn't exist or the key is already bound.
func PatchAddComponentVariable(dir, componentID, varKey, varValue string) error {
	path := dir + "/spin.toml"
	content, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("reading spin.toml: %w", err)
	}

	varLine := fmt.Sprintf("%s = %q", varKey, varValue)
	sectionHeader := fmt.Sprintf("[component.%s.variables]", componentID)
	compHeader := fmt.Sprintf("[component.%s]", componentID)

	lines := strings.Split(string(content), "\n")

	// Make sure the component itself exists.
	compIdx := -1
	for i, line := range lines {
		if strings.TrimSpace(line) == compHeader {
			compIdx = i
			break
		}
	}
	if compIdx < 0 {
		return fmt.Errorf("component %q not found in spin.toml", componentID)
	}

	// Check whether [component.id.variables] already exists.
	varSectionIdx := -1
	for i, line := range lines {
		if strings.TrimSpace(line) == sectionHeader {
			varSectionIdx = i
			break
		}
	}

	if varSectionIdx >= 0 {
		// Section exists — guard against duplicate key.
		if componentVarKeyExists(lines, varSectionIdx, varKey) {
			return fmt.Errorf("variable %q is already bound to component %q", varKey, componentID)
		}
		// Insert right after the section header.
		result := make([]string, 0, len(lines)+1)
		result = append(result, lines[:varSectionIdx+1]...)
		result = append(result, varLine)
		result = append(result, lines[varSectionIdx+1:]...)
		return os.WriteFile(path, []byte(strings.Join(result, "\n")), 0o644)
	}

	// Section absent — find the end of [component.id] and append there.
	subPrefix := compHeader[:len(compHeader)-1] + "."
	sectionEnd := len(lines)
	for i := compIdx + 1; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if strings.HasPrefix(trimmed, "[") && !strings.HasPrefix(trimmed, subPrefix) {
			sectionEnd = i
			break
		}
	}

	result := make([]string, 0, len(lines)+3)
	result = append(result, lines[:sectionEnd]...)
	result = append(result, "")
	result = append(result, sectionHeader)
	result = append(result, varLine)
	result = append(result, lines[sectionEnd:]...)
	return os.WriteFile(path, []byte(strings.Join(result, "\n")), 0o644)
}

// PatchAddKVBinding adds storeName to the key_value_stores array for the
// given component in spin.toml. Returns (true, nil) when added, (false, nil)
// when the binding was already present.
func PatchAddKVBinding(dir, componentID, storeName string) (bool, error) {
	return patchStoreBinding(dir, componentID, "key_value_stores", storeName)
}

// PatchAddSQLiteBinding adds dbName to the sqlite_databases array for the
// given component in spin.toml.
func PatchAddSQLiteBinding(dir, componentID, dbName string) (bool, error) {
	return patchStoreBinding(dir, componentID, "sqlite_databases", dbName)
}

// PatchRemoveKVBinding removes storeName from the key_value_stores array for
// the given component. Returns (true, nil) when removed, (false, nil) when
// the name was not present.
func PatchRemoveKVBinding(dir, componentID, storeName string) (bool, error) {
	return patchRemoveStoreBinding(dir, componentID, "key_value_stores", storeName)
}

// PatchRemoveSQLiteBinding removes dbName from the sqlite_databases array for
// the given component.
func PatchRemoveSQLiteBinding(dir, componentID, dbName string) (bool, error) {
	return patchRemoveStoreBinding(dir, componentID, "sqlite_databases", dbName)
}

// patchRemoveStoreBinding removes name from an inline array field inside a
// [component.<id>] section. Returns (true, nil) when removed, (false, nil)
// when name was not present.
func patchRemoveStoreBinding(dir, componentID, field, name string) (bool, error) {
	path := dir + "/spin.toml"
	content, err := os.ReadFile(path)
	if err != nil {
		return false, fmt.Errorf("reading spin.toml: %w", err)
	}

	lines := strings.Split(string(content), "\n")
	header := "[component." + componentID + "]"

	headerIdx := -1
	for i, line := range lines {
		if strings.TrimSpace(line) == header {
			headerIdx = i
			break
		}
	}
	if headerIdx < 0 {
		return false, fmt.Errorf("component section %q not found in spin.toml", header)
	}

	subPrefix := header[:len(header)-1] + "."
	sectionEnd := len(lines)
	for i := headerIdx + 1; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if strings.HasPrefix(trimmed, "[") && !strings.HasPrefix(trimmed, subPrefix) {
			sectionEnd = i
			break
		}
	}

	for i := headerIdx + 1; i < sectionEnd; i++ {
		trimmed := strings.TrimSpace(lines[i])
		if !(strings.HasPrefix(trimmed, field+" ") ||
			strings.HasPrefix(trimmed, field+"=") ||
			strings.HasPrefix(trimmed, field+"\t")) {
			continue
		}

		newLine, changed, nowEmpty := removeFromTOMLArray(lines[i], name)
		if !changed {
			return false, nil // not present — nothing to do
		}
		if nowEmpty {
			// Drop the whole field line rather than leaving `field = []`.
			lines = append(lines[:i], lines[i+1:]...)
		} else {
			lines[i] = newLine
		}
		return true, os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o644)
	}

	return false, nil // field line not found at all
}

// removeFromTOMLArray removes name from the inline TOML array in line.
// Returns (newLine, changed, nowEmpty).
func removeFromTOMLArray(line, name string) (string, bool, bool) {
	openIdx  := strings.Index(line, "[")
	closeIdx := strings.LastIndex(line, "]")
	if openIdx < 0 || closeIdx < 0 || closeIdx <= openIdx {
		return line, false, false
	}

	inner := strings.TrimSpace(line[openIdx+1 : closeIdx])
	var items []string
	if inner != "" {
		for _, s := range strings.Split(inner, ",") {
			s = strings.TrimSpace(s)
			s = strings.Trim(s, `"`)
			if s != "" {
				items = append(items, s)
			}
		}
	}

	found := false
	filtered := items[:0]
	for _, s := range items {
		if s == name {
			found = true
		} else {
			filtered = append(filtered, s)
		}
	}
	if !found {
		return line, false, false
	}
	if len(filtered) == 0 {
		return "", true, true
	}

	quoted := make([]string, len(filtered))
	for i, s := range filtered {
		quoted[i] = fmt.Sprintf("%q", s)
	}
	return line[:openIdx+1] + strings.Join(quoted, ", ") + line[closeIdx:], true, false
}

// patchStoreBinding is the shared implementation for KV and SQLite binding.
// It returns (true, nil) when the binding was added, (false, nil) when it was
// already present (no-op), and (false, err) on failure.
func patchStoreBinding(dir, componentID, field, name string) (added bool, err error) {
	path := dir + "/spin.toml"
	content, err := os.ReadFile(path)
	if err != nil {
		return false, fmt.Errorf("reading spin.toml: %w", err)
	}

	header := "[component." + componentID + "]"
	patched, changed, pErr := patchComponentListField(string(content), header, field, name)
	if pErr != nil {
		return false, pErr
	}
	if !changed {
		return false, nil
	}
	return true, os.WriteFile(path, []byte(patched), 0o644)
}

// ── Text-level patching helpers ───────────────────────────────────────────────

// insertAfterSectionHeader inserts newLine immediately after the line that
// exactly matches sectionHeader (after trimming whitespace).
// If the section is not found, a new section + line is appended at EOF.
func insertAfterSectionHeader(content, sectionHeader, newLine string) string {
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) == sectionHeader {
			result := make([]string, 0, len(lines)+1)
			result = append(result, lines[:i+1]...)
			result = append(result, newLine)
			result = append(result, lines[i+1:]...)
			return strings.Join(result, "\n")
		}
	}
	// Section not found — append it.
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return content + "\n" + sectionHeader + "\n" + newLine + "\n"
}

// patchComponentListField finds [component.<id>] and either appends name to
// an existing `field = [...]` line inside that section, or inserts a new
// `field = ["name"]` line right after the section header.
// The third return value reports whether any change was made.
func patchComponentListField(content, header, field, name string) (string, bool, error) {
	lines := strings.Split(content, "\n")

	// Locate the section header line.
	headerIdx := -1
	for i, line := range lines {
		if strings.TrimSpace(line) == header {
			headerIdx = i
			break
		}
	}
	if headerIdx < 0 {
		return "", false, fmt.Errorf("component section %q not found in spin.toml", header)
	}

	// Determine the extent of this section.
	// A line like [component.id.build] is a sub-section and still belongs to
	// [component.id], so we keep scanning past it.
	subPrefix := header[:len(header)-1] + "." // "[component.id."
	sectionEnd := len(lines)
	for i := headerIdx + 1; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if strings.HasPrefix(trimmed, "[") && !strings.HasPrefix(trimmed, subPrefix) {
			sectionEnd = i
			break
		}
	}

	// Look for an existing `field = [...]` line in the section body.
	fieldIdx := -1
	for i := headerIdx + 1; i < sectionEnd; i++ {
		trimmed := strings.TrimSpace(lines[i])
		if strings.HasPrefix(trimmed, field+" ") ||
			strings.HasPrefix(trimmed, field+"=") ||
			strings.HasPrefix(trimmed, field+"\t") {
			fieldIdx = i
			break
		}
	}

	if fieldIdx >= 0 {
		patched, changed := appendToTOMLArray(lines[fieldIdx], name)
		if !changed {
			return content, false, nil // already present — no-op
		}
		lines[fieldIdx] = patched
	} else {
		// Insert a brand-new field line right after the section header.
		newLine := fmt.Sprintf("%s = [%q]", field, name)
		result := make([]string, 0, len(lines)+1)
		result = append(result, lines[:headerIdx+1]...)
		result = append(result, newLine)
		result = append(result, lines[headerIdx+1:]...)
		lines = result
	}

	return strings.Join(lines, "\n"), true, nil
}

// ── Existence checks ──────────────────────────────────────────────────────────

// variableExists reports whether name is already declared as a key in the
// [variables] section of content.
func variableExists(content, name string) bool {
	lines := strings.Split(content, "\n")
	inVars := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "[variables]" {
			inVars = true
			continue
		}
		if inVars {
			// Another top-level section ends the [variables] block.
			if strings.HasPrefix(trimmed, "[") {
				return false
			}
			// Match "name = ..." or "name=..." ignoring leading whitespace.
			key := strings.SplitN(trimmed, "=", 2)[0]
			if strings.TrimSpace(key) == name {
				return true
			}
		}
	}
	return false
}

// componentVarKeyExists reports whether varKey already appears as a key inside
// the [component.id.variables] section (lines starting at sectionIdx).
func componentVarKeyExists(lines []string, sectionIdx int, varKey string) bool {
	for i := sectionIdx + 1; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if strings.HasPrefix(trimmed, "[") {
			break
		}
		key := strings.SplitN(trimmed, "=", 2)[0]
		if strings.TrimSpace(key) == varKey {
			return true
		}
	}
	return false
}

// appendToTOMLArray appends name to the inline TOML array in line, e.g.:
//
//	key_value_stores = ["default"]  →  key_value_stores = ["default", "sessions"]
//
// Returns the modified line and true if a change was made (false when name was
// already present).
func appendToTOMLArray(line, name string) (string, bool) {
	openIdx := strings.Index(line, "[")
	closeIdx := strings.LastIndex(line, "]")
	if openIdx < 0 || closeIdx < 0 || closeIdx <= openIdx {
		return line, false // malformed — leave untouched
	}

	inner := strings.TrimSpace(line[openIdx+1 : closeIdx])
	var items []string
	if inner != "" {
		for _, s := range strings.Split(inner, ",") {
			s = strings.TrimSpace(s)
			s = strings.Trim(s, `"`)
			if s != "" {
				items = append(items, s)
			}
		}
	}

	for _, s := range items {
		if s == name {
			return line, false // already there
		}
	}

	items = append(items, name)
	quoted := make([]string, len(items))
	for i, s := range items {
		quoted[i] = fmt.Sprintf("%q", s)
	}

	return line[:openIdx+1] + strings.Join(quoted, ", ") + line[closeIdx:], true
}
