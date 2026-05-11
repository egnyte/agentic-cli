'use strict';

/**
 * applyFields — limit which fields are returned to the agent.
 *
 * Agent rule: always --fields on list calls to reduce token cost.
 * This function is pure (no I/O) so it is directly unit-testable.
 *
 * Supports arbitrary dotted-path projection: "events.data.target_id"
 * projects { events: [{ data: { target_id: ... } }] }.
 */

// Build a projection tree from a list of dotted field specs.
// "a.b.c,a.d,e" → { a: { b: { c: true }, d: true }, e: true }
function buildTree(keys) {
    const tree = {};
    for (const k of keys) {
        const parts = k.split('.');
        let node = tree;
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            if (i === parts.length - 1) {
                if (!node[p]) node[p] = true;
            } else {
                if (node[p] === true) break; // parent already selected whole subtree
                if (!node[p]) node[p] = {};
                node = node[p];
            }
        }
    }
    return tree;
}

// Recursively project obj using a tree node.
// tree === true means keep the value as-is.
// tree === object means descend into children.
function project(val, tree) {
    if (tree === true) return val;
    if (val === null || val === undefined) return val;
    if (Array.isArray(val)) return val.map(function(item) { return project(item, tree); });
    if (typeof val !== 'object') return val;

    const childKeys = Object.keys(tree);
    if (childKeys.length === 0) return val;

    const result = {};
    for (const k of childKeys) {
        if (k in val) result[k] = project(val[k], tree[k]);
    }
    return result;
}

// Auto-preserve known envelope wrapper keys so callers don't need to list them.
// 'Resources' (capital R) = SCIM envelope for users/groups list.
const ENVELOPE_KEYS = ['files', 'folders', 'items', 'resources', 'Resources', 'data', 'content', 'results', 'links', 'events'];

function applyFields(obj, fields) {
    if (!fields) return obj;
    if (obj === null || obj === undefined) return obj;

    const keys = fields.split(',').map(function(f) { return f.trim(); }).filter(Boolean);
    const tree = buildTree(keys);

    if (Array.isArray(obj)) return project(obj, tree);

    // Flat keys that are not top-level envelope keys in this response — candidates for item-level filtering.
    const nonEnvelopeFlatKeys = keys.filter(function(k) {
        return k.indexOf('.') === -1 && !(ENVELOPE_KEYS.includes(k) && k in obj);
    });

    for (const pk of ENVELOPE_KEYS) {
        if (!(pk in obj)) continue;

        if (pk in tree) {
            // Caller selected envelope key as a flat key (tree[pk] === true).
            // If other non-envelope flat keys exist, use them as item-level filter.
            if (tree[pk] === true && nonEnvelopeFlatKeys.length > 0) {
                tree[pk] = buildTree(nonEnvelopeFlatKeys);
            }
            // Otherwise dotted-path already set tree[pk] to a subtree — leave it.
        } else {
            // Auto-include envelope key. Apply item-level filter if non-envelope flat keys exist.
            tree[pk] = nonEnvelopeFlatKeys.length > 0 ? buildTree(nonEnvelopeFlatKeys) : true;
        }
    }

    // Always preserve _ratelimit when present (injected by --verbose)
    if ('_ratelimit' in obj) tree['_ratelimit'] = true;

    return project(obj, tree);
}

module.exports = { applyFields };
