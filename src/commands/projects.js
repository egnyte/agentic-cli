'use strict';

const { resolveAuth }                    = require('../lib/auth');
const { parseJsonArg }                   = require('../lib/args');
const { buildBodyFromRow, isBulkMode,
        loadBulkRows, runBulkOperation } = require('../lib/bulk');
const { applyFields }                    = require('../lib/fields');
const { apiRequest, buildUrl }           = require('../lib/http');
const { out, formatDryRun, printDryRun, CLIError,
        requireConfirmation }            = require('../lib/output');

const PROJECTS_V1_API = '/pubapi/v1/project-folders';
const PROJECTS_V2_API = '/pubapi/v2/project-folders';

// ── projects list ─────────────────────────────────────────────────────────────
// Note: Uses v2 for better pagination and structured response.

async function cmdProjectsList(args) {
    const { token, domain } = await resolveAuth(args);
    const apiPath = PROJECTS_V2_API;
    const query = parseJsonArg(args.json);

    if (args['dry-run']) {
        printDryRun({ method: 'GET', url: buildUrl(domain, apiPath), query });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'GET', apiPath, query });
    out(applyFields(result, args.fields));
}

// ── projects get ──────────────────────────────────────────────────────────────
// Note: Uses v2 path-based retrieval.

async function cmdProjectsGet(args) {
    const projectId = args._[2];
    if (!projectId) {
        throw new CLIError('Project ID is required: egnyte projects get <project_id>');
    }

    const { token, domain } = await resolveAuth(args);
    const apiPath = PROJECTS_V2_API + '/' + projectId;

    if (args['dry-run']) {
        printDryRun({ method: 'GET', url: buildUrl(domain, apiPath) });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'GET', apiPath });
    out(applyFields(result, args.fields));
}

// ── projects create ───────────────────────────────────────────────────────────
// Note: Handles both v1 (mark folder as project) and v2 (create from template).
// If templateFolderId is present, we use v2. Otherwise, we assume v1.

async function cmdProjectsCreate(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'projects.create',
            rows,
            createTask: function(row) {
                const body = buildBodyFromRow(row, ['label']);
                if (!body.name || !body.status) throw new CLIError('Bulk CSV row requires "name" and "status" fields');
                const isTemplate = !!body.templateFolderId;
                if (isTemplate && !body.parentFolderId) throw new CLIError('"parentFolderId" is required when creating from a template');
                if (!isTemplate && !body.rootFolderId) throw new CLIError('"rootFolderId" is required when marking an existing folder as a project');
                return { label: String(body.name), body: body, apiPath: isTemplate ? PROJECTS_V2_API : PROJECTS_V1_API };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'POST', url: buildUrl(domain, task.apiPath), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                return await apiRequest({ domain, token, method: 'POST', apiPath: task.apiPath, body: task.body, bodyType: 'json' });
            },
        });
        if (summary) out(summary);
        return;
    }

    const body = parseJsonArg(args.json);

    // Basic validation
    if (!body.name || !body.status) {
        throw new CLIError('"name" and "status" are required in --json');
    }

    const isTemplate = !!body.templateFolderId;
    const apiPath = isTemplate ? PROJECTS_V2_API : PROJECTS_V1_API;
    
    // Additional validation for template vs mark
    if (isTemplate && !body.parentFolderId) {
        throw new CLIError('"parentFolderId" is required when creating from a template');
    }
    if (!isTemplate && !body.rootFolderId) {
        throw new CLIError('"rootFolderId" is required when marking an existing folder as a project');
    }

    requireConfirmation(args);
    if (args['dry-run']) {
        printDryRun({ method: 'POST', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'POST', apiPath, body, bodyType: 'json' });
    out(result);
}

// ── projects update ───────────────────────────────────────────────────────────
// Note: Uses v2 PATCH for metadata updates.

async function cmdProjectsUpdate(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'projects.update',
            rows,
            createTask: function(row) {
                const projectId = row.id || row.projectId;
                if (!projectId) throw new CLIError('Bulk CSV row requires an "id" or "projectId" column');
                const body = buildBodyFromRow(row, ['id', 'projectId', 'label']);
                if (Object.keys(body).length === 0) throw new CLIError('Bulk CSV row requires at least one update field');
                return { label: String(projectId), id: projectId, body: body };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'PATCH', url: buildUrl(domain, PROJECTS_V2_API + '/' + task.id), body: task.body, bodyType: 'json' });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'PATCH', apiPath: PROJECTS_V2_API + '/' + task.id, body: task.body, bodyType: 'json' });
                return result || { status: 'updated', id: task.id };
            },
        });
        if (summary) out(summary);
        return;
    }

    const projectId = args._[2];
    if (!projectId) {
        throw new CLIError('Project ID is required: egnyte projects update <project_id> --json "{...}"');
    }

    const body = parseJsonArg(args.json);
    if (Object.keys(body).length === 0) {
        throw new CLIError('JSON body is required for update: --json \'{"status": "completed"}\'');
    }

    const apiPath = PROJECTS_V2_API + '/' + projectId;
    requireConfirmation(args);

    if (args['dry-run']) {
        printDryRun({ method: 'PATCH', url: buildUrl(domain, apiPath), body, bodyType: 'json' });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'PATCH', apiPath, body, bodyType: 'json' });
    out(result || { status: 'updated', id: projectId });
}

// ── projects delete ───────────────────────────────────────────────────────────
// Note: Uses v2 DELETE. This demotes the folder back to a normal folder.

async function cmdProjectsDelete(args) {
    const { token, domain } = await resolveAuth(args);
    if (isBulkMode(args)) {
        requireConfirmation(args);
        const rows = loadBulkRows(args);
        const summary = await runBulkOperation({
            args,
            operation: 'projects.delete',
            rows,
            createTask: function(row) {
                const projectId = row.id || row.projectId;
                if (!projectId) throw new CLIError('Bulk CSV row requires an "id" or "projectId" column');
                return { label: String(projectId), id: projectId };
            },
            formatDryRun: function(task) {
                return formatDryRun({ method: 'DELETE', url: buildUrl(domain, PROJECTS_V2_API + '/' + task.id) });
            },
            executeTask: async function(task) {
                const result = await apiRequest({ domain, token, method: 'DELETE', apiPath: PROJECTS_V2_API + '/' + task.id });
                return result || { status: 'deleted', id: task.id };
            },
        });
        if (summary) out(summary);
        return;
    }

    const projectId = args._[2];
    if (!projectId) {
        throw new CLIError('Project ID is required: egnyte projects delete <project_id>');
    }

    const apiPath = PROJECTS_V2_API + '/' + projectId;
    requireConfirmation(args);

    if (args['dry-run']) {
        printDryRun({ method: 'DELETE', url: buildUrl(domain, apiPath) });
        return;
    }

    const result = await apiRequest({ domain, token, method: 'DELETE', apiPath });
    out(result || { status: 'deleted', id: projectId });
}

module.exports = { cmdProjectsList, cmdProjectsGet, cmdProjectsCreate, cmdProjectsUpdate, cmdProjectsDelete };
