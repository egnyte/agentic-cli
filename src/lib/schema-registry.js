'use strict';

const BULK_MUTATION_FLAGS = {
    'bulk-file-path': {
        description: 'Path to a CSV file. Each data row becomes one command execution in bulk mode.',
    },
    'from-csv': {
        description: 'Alias for --bulk-file-path.',
    },
    parallelism: {
        description: 'Max in-flight bulk operations. Defaults to 2 to stay within typical Egnyte token QPS limits.',
    },
    progress: {
        description: 'Write human-readable progress updates to stderr during bulk or long-running execution.',
    },
    'json-progress': {
        description: 'Write newline-delimited JSON progress events to stderr for agents and automation.',
    },
};

const TRANSFER_PROGRESS_FLAGS = {
    progress: {
        description: 'Write human-readable transfer progress updates to stderr.',
    },
    'json-progress': {
        description: 'Write newline-delimited JSON transfer progress events to stderr for agents and automation.',
    },
};

/**
 * SCHEMA registry — runtime introspection for AI agents.
 *
 * Agent rule: run `egnyte schema --list` / `egnyte schema <op>` before any call
 * to discover available operations and their parameters without pre-loaded docs.
 *
 * Each entry encodes: summary, HTTP method, endpoint template, mutating flag,
 * parameter definitions, and a copy-paste example.
 */
const SCHEMA = {

    // ── File System ─────────────────────────────────────────────────────────────

    'fs.get': {
        summary:  'Get file/folder metadata or list folder contents',
        method:   'GET',
        endpoint: '/pubapi/v1/fs/{path}',
        mutating: false,
        query_params: {
            list_content:   { type: 'boolean', description: 'Set true to list folder contents' },
            count:          { type: 'integer', description: 'Number of items to return (pagination)' },
            offset:         { type: 'integer', description: 'Pagination offset' },
            sort_by:        { type: 'string',  description: 'Field to sort by' },
            sort_direction: { type: 'string',  description: 'asc or desc' },
        },
        example: "egnyte fs get /Shared --json '{\"list_content\": true}' --fields name,path,size",
    },
    'fs.action': {
        summary:     'Perform a file/folder operation: add_folder | move | copy. Use fs rename / fs move / fs copy for human-friendly wrappers.',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs/{path}',
        mutating:    true,
        body_params: {
            action:      { type: 'string', required: true,  description: 'add_folder | move | copy' },
            destination: { type: 'string', required: false, description: 'Destination path (required for move and copy)' },
        },
        example: "egnyte fs action /Shared/NewFolder --json '{\"action\": \"add_folder\"}' --dry-run",
    },
    'fs.mkdir': {
        summary:     'Create a folder at the given path',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs/{path}',
        mutating:    true,
        body_params: {},
        example:     'egnyte fs mkdir /Shared/NewFolder --yes',
    },
    'fs.rename': {
        summary:     'Rename a file or folder',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs/{path}',
        mutating:    true,
        body_params: {
            name: { type: 'string', required: true, description: 'New name for the file or folder' },
        },
        example:     'egnyte fs rename /Shared/old.pdf --name new.pdf --yes',
    },
    'fs.move': {
        summary:     'Move a file or folder to a new path',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs/{path}',
        mutating:    true,
        body_params: {
            to: { type: 'string', required: true, description: 'Destination path (must start with /)' },
        },
        example:     'egnyte fs move /Shared/old.pdf --to /Shared/Archive/old.pdf --yes',
    },
    'fs.copy': {
        summary:     'Copy a file or folder to a new path',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs/{path}',
        mutating:    true,
        body_params: {
            to: { type: 'string', required: true, description: 'Destination path (must start with /)' },
        },
        example:     'egnyte fs copy /Shared/report.pdf --to /Shared/Archive/report.pdf --yes',
    },
    'fs.delete': {
        summary:     'Delete a file or folder',
        method:      'DELETE',
        endpoint:    '/pubapi/v1/fs/{path}',
        mutating:    true,
        body_params: {},
        example:     'egnyte fs delete /Shared/old.pdf --dry-run',
    },
    'fs.upload': {
        summary:     'Upload a local file to Egnyte',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs-content/{path}',
        mutating:    true,
        body_params: {
            file: { type: 'binary', required: true, description: 'Local file path — provide via --file <path>' },
        },
        example: 'egnyte fs upload /Shared/docs/report.pdf --file ./report.pdf --dry-run',
    },
    'fs.download': {
        summary:     'Download a file by its Egnyte path',
        method:      'GET',
        endpoint:    '/pubapi/v1/fs-content/{path}',
        mutating:    false,
        body_params: {},
        example:     'egnyte fs download /Shared/docs/report.pdf --out ./report.pdf',
    },
    'fs.download-by-id': {
        summary:     'Download a file by its group_id (from upload response or fs get metadata)',
        method:      'GET',
        endpoint:    '/pubapi/v1/fs-content/ids/file/{group_id}',
        mutating:    false,
        body_params: {},
        example:     'egnyte fs download-by-id <group-id> --out ./report.pdf',
    },
    'fs.upload-chunked': {
        summary:     'Upload a large file using the Egnyte chunked upload protocol (recommended for files > 10 MB)',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs-content-chunked/{path}',
        mutating:    true,
        body_params: {
            file:          { type: 'binary',  required: true,  description: 'Local file path — provide via --file <path>' },
            'chunk-size':  { type: 'integer', required: false, description: 'Chunk size in bytes (default 10485760 = 10 MB)' },
        },
        example: 'egnyte fs upload-chunked /Shared/bigfile.iso --file ./bigfile.iso --dry-run',
    },

    'fs.get-content': {
        summary:  'Fetch the text content of a file with pagination support',
        method:   'GET',
        endpoint: '/pubapi/v1/fs-content/{path}',
        mutating: false,
        query_params: {
            offset: { type: 'integer', required: false, description: 'Byte offset to start reading from' },
            limit:  { type: 'integer', required: false, description: 'Max bytes to return' },
        },
        example: "egnyte fs get-content /Shared/report.txt --json '{\"offset\":0,\"limit\":5000}'",
    },
    'fs.set-metadata': {
        summary:     'Set custom metadata on a file using a named namespace (path auto-resolved to entry-id)',
        method:      'PUT',
        endpoint:    '/pubapi/v1/fs/ids/file/{entry_id}/properties/{namespace}',
        mutating:    true,
        body_params: {
            namespace: { type: 'string', required: true,  description: 'Metadata namespace name' },
            values:    { type: 'object', required: true,  description: 'Key-value pairs to set on the file' },
        },
        example: "egnyte fs set-metadata /Shared/contract.pdf --json '{\"namespace\":\"contract\",\"values\":{\"status\":\"signed\"}}' --dry-run",
    },
    'fs.list-metadata-namespaces': {
        summary:  'List all available custom metadata namespaces and their field definitions',
        method:   'GET',
        endpoint: '/pubapi/v1/properties/namespace',
        mutating: false,
        example:  'egnyte fs list-metadata-namespaces --fields name,displayName',
    },

    // ── Search ──────────────────────────────────────────────────────────────────

    'search': {
        summary:  'Search for files and folders across the Egnyte domain',
        method:   'GET',
        endpoint: '/pubapi/v1/search',
        mutating: false,
        query_params: {
            query:   { type: 'string',  required: true,  description: 'Full-text search query' },
            count:   { type: 'integer', required: false, description: 'Max results to return (default 25, max 100)' },
            offset:  { type: 'integer', required: false, description: 'Pagination offset' },
            folder:  { type: 'string',  required: false, description: 'Restrict results to this folder path' },
            type:    { type: 'string',  required: false, description: 'Filter by type: file | folder' },
            group_by_type: { type: 'boolean', required: false, description: 'Group results by file type' },
        },
        example: "egnyte search 'quarterly report' --json '{\"count\": 20, \"folder\": \"/Shared\"}' --fields name,path,size",
    },
    'search.advanced': {
        summary:  'Advanced search with metadata filters, date ranges, folder scoping, and similarity options',
        method:   'GET',
        endpoint: '/pubapi/v1/search',
        mutating: false,
        query_params: {
            query:               { type: 'string',  required: true,  description: 'Full-text or semantic search query' },
            folder:              { type: 'string',  required: false, description: 'Restrict results to this folder path' },
            type:                { type: 'string',  required: false, description: 'Filter by type: file | folder' },
            custom_metadata:     { type: 'object',  required: false, description: 'Filter by custom metadata key-value pairs' },
            modified_before:     { type: 'string',  required: false, description: 'ISO 8601 date — only files modified before this date' },
            modified_after:      { type: 'string',  required: false, description: 'ISO 8601 date — only files modified after this date' },
            uploaded_before:     { type: 'string',  required: false, description: 'ISO 8601 date — only files uploaded before this date' },
            uploaded_after:      { type: 'string',  required: false, description: 'ISO 8601 date — only files uploaded after this date' },
            sort_by:             { type: 'string',  required: false, description: 'Field to sort results by' },
            file_query_fields:   { type: 'array',   required: false, description: 'Restrict full-text search to these file fields' },
            folder_query_fields: { type: 'array',   required: false, description: 'Restrict full-text search to these folder fields' },
            namespaces:          { type: 'array',   required: false, description: 'Metadata namespaces to include in results' },
            count:               { type: 'integer', required: false, description: 'Max results to return (default 25, max 100)' },
            offset:              { type: 'integer', required: false, description: 'Pagination offset' },
        },
        example: "egnyte search advanced 'contract' --json '{\"folder\":\"/Shared\",\"modified_after\":\"2024-01-01\",\"custom_metadata\":{\"status\":\"signed\"}}' --fields name,path",
    },

    // ── Links ───────────────────────────────────────────────────────────────────

    'links.create': {
        summary:     'Create a shared link for a file or folder',
        method:      'POST',
        endpoint:    '/pubapi/v1/links',
        mutating:    true,
        body_params: {
            path:             { type: 'string',  required: true,  description: 'Egnyte path to the file or folder' },
            type:             { type: 'string',  required: true,  description: 'file | folder' },
            accessibility:    { type: 'string',  required: true,  description: 'anyone | domain | password | recipients' },
            send_email:       { type: 'boolean', required: false, description: 'Send link via email' },
            copy_me:          { type: 'boolean', required: false, description: 'Copy the link creator on email' },
            notify:           { type: 'boolean', required: false, description: 'Notify creator when link is accessed' },
            link_to_current:  { type: 'boolean', required: false, description: 'Link to current version only' },
            expiry_date:      { type: 'string',  required: false, description: 'Expiry date (YYYY-MM-DD)' },
            expiry_clicks:    { type: 'integer', required: false, description: 'Max number of link clicks' },
            require_password: { type: 'boolean', required: false, description: 'Require a password to access link' },
            password:         { type: 'string',  required: false, description: 'Password for the link' },
        },
        example: "egnyte links create --json '{\"path\": \"/Shared/report.pdf\", \"type\": \"file\", \"accessibility\": \"anyone\"}' --dry-run",
    },
    'links.list': {
        summary:  'List shared links, optionally filtered by path',
        method:   'GET',
        endpoint: '/pubapi/v1/links',
        mutating: false,
        query_params: {
            path:       { type: 'string',  required: false, description: 'Filter links for this Egnyte path' },
            username:   { type: 'string',  required: false, description: 'Filter links created by this user' },
            created_before: { type: 'string', required: false, description: 'Filter links created before date (YYYY-MM-DD)' },
            created_after:  { type: 'string', required: false, description: 'Filter links created after date (YYYY-MM-DD)' },
            page:       { type: 'integer', required: false, description: 'Page number for pagination' },
            count:      { type: 'integer', required: false, description: 'Number of results per page' },
            link_type:  { type: 'string',  required: false, description: 'Filter by type: file | folder' },
        },
        example: "egnyte links list --json '{\"count\": 10}' --fields count,ids,total_count",
    },
    'links.get': {
        summary:  'Get details of a specific shared link by ID',
        method:   'GET',
        endpoint: '/pubapi/v1/links/{id}',
        mutating: false,
        query_params: {},
        example:  'egnyte links get <link-id> --fields id,url,path,accessibility',
    },
    'links.delete': {
        summary:     'Delete a shared link by ID',
        method:      'DELETE',
        endpoint:    '/pubapi/v1/links/{id}',
        mutating:    true,
        body_params: {},
        example:     'egnyte links delete <link-id> --dry-run',
    },

    // ── Users ───────────────────────────────────────────────────────────────────

    'users.get': {
        summary:  'Get a user by numeric ID or username',
        method:   'GET',
        endpoint: '/pubapi/v2/users/{id}',
        mutating: false,
        query_params: {},
        example:  "egnyte users get 123 --fields userName,email,active",
    },
    'users.list': {
        summary:  'List users with optional filtering and pagination',
        method:   'GET',
        endpoint: '/pubapi/v2/users',
        mutating: false,
        query_params: {
            startIndex: { type: 'integer', required: false, description: 'Pagination start index (1-based)' },
            count:      { type: 'integer', required: false, description: 'Number of users to return' },
            filter:     { type: 'string',  required: false, description: 'SCIM filter e.g. userName eq "jsmith"' },
            sortBy:     { type: 'string',  required: false, description: 'Field to sort by (e.g. userName)' },
            sortOrder:  { type: 'string',  required: false, description: 'ascending | descending' },
        },
        example: "egnyte users list --json '{\"count\": 50}' --fields resources.id,resources.userName,resources.email,resources.active",
    },
    'users.create': {
        summary:     'Create a new user',
        method:      'POST',
        endpoint:    '/pubapi/v2/users',
        mutating:    true,
        body_params: {
            userName:       { type: 'string',  required: true,  description: 'Username (typically email address)' },
            email:          { type: 'string',  required: true,  description: 'Plain email string e.g. "user@company.com"' },
            name:           { type: 'object',  required: true,  description: '{"familyName": "Smith", "givenName": "John"}' },
            active:         { type: 'boolean', required: true,  description: 'Whether the user is active' },
            userType:       { type: 'string',  required: true,  description: 'egnyte | sso | google | powerBI' },
            authType:       { type: 'string',  required: true,  description: 'egnyte | sso | google' },
            externalId:     { type: 'string',  required: false, description: 'External identifier' },
            sendInvite:     { type: 'boolean', required: false, description: 'Send an invitation email to the new user' },
            role:           { type: 'string',  required: false, description: 'admin | collaborator | viewer | power-user | member' },
        },
        example: "egnyte users create --json '{\"userName\":\"jsmith\",\"email\":\"jsmith@co.com\",\"name\":{\"familyName\":\"Smith\",\"givenName\":\"John\"},\"active\":true,\"userType\":\"standard\",\"authType\":\"egnyte\"}' --dry-run",
    },
    'users.update': {
        summary:     'Update an existing user (SCIM PATCH)',
        method:      'PATCH',
        endpoint:    '/pubapi/v2/users/{id}',
        mutating:    true,
        body_params: {
            active:   { type: 'boolean', required: false, description: 'Activate or deactivate the user' },
            name:     { type: 'object',  required: false, description: '{"familyName": "...", "givenName": "..."}' },
            email:    { type: 'object',  required: false, description: '{"value": "new@company.com"}' },
            role:     { type: 'string',  required: false, description: 'admin | collaborator | viewer | power-user | member' },
            userType: { type: 'string',  required: false, description: 'egnyte | sso | google | powerBI' },
        },
        example: "egnyte users update 123 --json '{\"active\": false}' --dry-run",
    },
    'users.delete': {
        summary:     'Delete a user by ID',
        method:      'DELETE',
        endpoint:    '/pubapi/v2/users/{id}',
        mutating:    true,
        body_params: {},
        example:     'egnyte users delete 123 --dry-run',
    },

    // ── Groups ──────────────────────────────────────────────────────────────────

    'groups.get': {
        summary:  'Get a group by ID',
        method:   'GET',
        endpoint: '/pubapi/v2/groups/{id}',
        mutating: false,
        query_params: {},
        example:  'egnyte groups get <group-id> --fields displayName,members',
    },
    'groups.list': {
        summary:  'List all groups with optional pagination',
        method:   'GET',
        endpoint: '/pubapi/v2/groups',
        mutating: false,
        query_params: {
            startIndex: { type: 'integer', required: false, description: 'Pagination start index (1-based)' },
            count:      { type: 'integer', required: false, description: 'Number of groups to return' },
            filter:     { type: 'string',  required: false, description: 'SCIM filter e.g. displayName eq "Engineering"' },
        },
        example: "egnyte groups list --json '{\"count\": 50}' --fields resources.id,resources.displayName",
    },
    'groups.create': {
        summary:     'Create a new group',
        method:      'POST',
        endpoint:    '/pubapi/v2/groups',
        mutating:    true,
        body_params: {
            displayName: { type: 'string', required: true,  description: 'Group display name' },
            members:     { type: 'array',  required: false, description: '[{"value": "<user-id>"}]' },
        },
        example: "egnyte groups create --json '{\"displayName\": \"Engineering\"}' --dry-run",
    },
    'groups.update': {
        summary:     'Update a group (add/remove members or rename)',
        method:      'PATCH',
        endpoint:    '/pubapi/v2/groups/{id}',
        mutating:    true,
        body_params: {
            displayName: { type: 'string', required: false, description: 'New group display name' },
            members:     { type: 'array',  required: false, description: 'Full member list — replaces existing members' },
        },
        example: "egnyte groups update <group-id> --json '{\"displayName\": \"Eng Team\"}' --dry-run",
    },
    'groups.delete': {
        summary:     'Delete a group by ID',
        method:      'DELETE',
        endpoint:    '/pubapi/v2/groups/{id}',
        mutating:    true,
        body_params: {},
        example:     'egnyte groups delete <group-id> --dry-run',
    },

    // ── Permissions ─────────────────────────────────────────────────────────────

    'perms.get-user': {
        summary:  'Get all permissions for a folder (returns both users and groups). Use --fields users to scope output.',
        method:   'GET',
        endpoint: '/pubapi/v1/perms/folder/{folderpath}',
        mutating: false,
        query_params: {},
        example:  'egnyte perms get-user /Shared/Finance --fields users',
    },
    'perms.set-user': {
        summary:     'Set user permissions on a folder',
        method:      'POST',
        endpoint:    '/pubapi/v1/perms/user/{folderpath}',
        mutating:    true,
        body_params: {
            users: { type: 'object', required: true, description: '{"username": "Viewer|Editor|Owner|None"}' },
        },
        example: "egnyte perms set-user /Shared/Finance --json '{\"users\": {\"jsmith\": \"Viewer\"}}' --dry-run",
    },
    'perms.delete-user': {
        summary:     'Remove user permissions from a folder',
        method:      'DELETE',
        endpoint:    '/pubapi/v1/perms/user/{folderpath}',
        mutating:    true,
        body_params: {
            users: { type: 'array', required: true, description: '["username1", "username2"]' },
        },
        example: "egnyte perms delete-user /Shared/Finance --json '{\"users\": [\"jsmith\"]}' --dry-run",
    },
    'perms.get-group': {
        summary:  'Get all permissions for a folder (returns both users and groups). Use --fields groups to scope output.',
        method:   'GET',
        endpoint: '/pubapi/v1/perms/folder/{folderpath}',
        mutating: false,
        query_params: {},
        example:  'egnyte perms get-group /Shared/Finance --fields groups',
    },
    'perms.set-group': {
        summary:     'Set group permissions on a folder',
        method:      'POST',
        endpoint:    '/pubapi/v1/perms/group/{folderpath}',
        mutating:    true,
        body_params: {
            groups: { type: 'object', required: true, description: '{"GroupName": "Viewer|Editor|Owner|None"}' },
        },
        example: "egnyte perms set-group /Shared/Finance --json '{\"groups\": {\"Engineering\": \"Editor\"}}' --dry-run",
    },
    'perms.delete-group': {
        summary:     'Remove group permissions from a folder',
        method:      'DELETE',
        endpoint:    '/pubapi/v1/perms/group/{folderpath}',
        mutating:    true,
        body_params: {
            groups: { type: 'array', required: true, description: '["GroupName1", "GroupName2"]' },
        },
        example: "egnyte perms delete-group /Shared/Finance --json '{\"groups\": [\"Engineering\"]}' --dry-run",
    },
    'perms.get-by-user': {
        summary:  "Get a specific user's permission level on a folder",
        method:   'GET',
        endpoint: '/pubapi/v1/perms/user/{username}',
        mutating: false,
        query_params: {
            folder: { type: 'string', required: true, description: 'Folder path to check permission on' },
        },
        example: "egnyte perms get-by-user jsmith --json '{\"folder\": \"/Shared/Finance\"}'",
    },

    // ── User Info ───────────────────────────────────────────────────────────────

    'userinfo': {
        summary:      "Get the authenticated user's live profile from the Egnyte API",
        method:       'GET',
        endpoint:     '/pubapi/v1/userinfo',
        mutating:     false,
        query_params: {},
        example:      'egnyte userinfo --fields username,email,user_type',
    },

    // ── Events / Audit Trail ────────────────────────────────────────────────────

    'events.get-cursor': {
        summary:     'Get the ID of the latest event (use as start for events list)',
        method:      'GET',
        endpoint:    '/pubapi/v1/events/cursor',
        mutating:    false,
        query_params: {},
        example:     'egnyte events get-cursor',
    },
    'events.list': {
        summary:  'List audit events starting from a given event ID',
        method:   'GET',
        endpoint: '/pubapi/v1/events',
        mutating: false,
        query_params: {
            id:       { type: 'integer', required: true,  description: 'Start event ID — get from events get-cursor' },
            count:    { type: 'integer', required: false, description: 'Number of events to return (default 20)' },
            folder:   { type: 'string',  required: false, description: 'Filter events to a specific folder path' },
            type:     { type: 'string',  required: false, description: 'Filter by event type(s), pipe-separated: create|move|delete|edit|lock|unlock|restore' },
            suppress: { type: 'string',  required: false, description: 'Suppress own events: "app" (default) or "user"' },
        },
        example: "egnyte events list --json '{\"id\":12345,\"count\":20,\"folder\":\"/Shared\",\"type\":\"create|move\"}'",
    },

    // ── Notes / Comments ────────────────────────────────────────────────────────

    'notes.add': {
        summary:     'Add a note/comment to a file',
        method:      'POST',
        endpoint:    '/pubapi/v1/notes',
        mutating:    true,
        body_params: {
            body: { type: 'string', required: true, description: 'Note text content' },
        },
        example: "egnyte notes add /Shared/report.pdf --json '{\"body\":\"Please review section 3\"}' --dry-run",
    },
    'notes.list': {
        summary:     'List all notes on a file',
        method:      'GET',
        endpoint:    '/pubapi/v1/notes',
        mutating:    false,
        query_params: {
            file: { type: 'string', required: true, description: 'File path (provided as the path argument, not --json)' },
        },
        example: 'egnyte notes list /Shared/report.pdf',
    },
    'notes.get': {
        summary:     'Get a single note by ID',
        method:      'GET',
        endpoint:    '/pubapi/v1/notes/{id}',
        mutating:    false,
        query_params: {},
        example:     'egnyte notes get <note-id>',
    },
    'notes.delete': {
        summary:     'Delete a note by ID',
        method:      'DELETE',
        endpoint:    '/pubapi/v1/notes/{id}',
        mutating:    true,
        body_params: {},
        example:     'egnyte notes delete <note-id> --dry-run',
    },

    // ── AI ──────────────────────────────────────────────────────────────────────

    'ai.ask': {
        summary:     'Ask a question via Copilot, optionally scoped to specific files or folders',
        method:      'POST',
        endpoint:    '/pubapi/v1/ai/copilot/ask',
        mutating:    false,
        body_params: {
            question:          { type: 'string',  required: true,  description: 'Natural-language question' },
            selectedItems:     { type: 'object',  required: false, description: 'Files/folders to use as context: {"folders":[{"id":"..."}],"files":[{"entryId":"..."}]}' },
            includeCitations:  { type: 'boolean', required: false, description: 'Include source citations in response' },
            chatHistory:       { type: 'object',  required: false, description: 'Prior conversation context: {"messages":[]}' },
        },
        example: "egnyte ai ask \"What are the key metrics in Q3?\" --json '{\"selectedItems\":{\"folders\":[{\"id\":\"f1\"}]},\"includeCitations\":true}'",
    },
    'ai.ask-document': {
        summary:     'Ask a question about a specific file (path auto-resolved to entry-id)',
        method:      'POST',
        endpoint:    '/pubapi/v1/ai/document/{entry-id}/ask',
        mutating:    false,
        body_params: {
            question:         { type: 'string',  required: true,  description: 'Natural-language question about the file' },
            includeCitations: { type: 'boolean', required: false, description: 'Include source citations in response' },
            chatHistory:      { type: 'object',  required: false, description: 'Prior conversation context: {"messages":[]}' },
        },
        example: 'egnyte ai ask-document /Shared/Contracts/acme.pdf "What are the payment terms?" --json \'{"includeCitations":true}\'',
    },
    'ai.summarize': {
        summary:     'Summarize the content of a file (path auto-resolved to entry-id)',
        method:      'POST',
        endpoint:    '/pubapi/v1/ai/document/{entry-id}/summary',
        mutating:    false,
        body_params: {
            chatHistory: { type: 'object', required: false, description: 'Prior conversation context: {"messages":[]}' },
        },
        example: 'egnyte ai summarize /Shared/Reports/annual-report.pdf --fields response',
    },
    'ai.ask-kb': {
        summary:     'Query a specific Knowledge Base',
        method:      'POST',
        endpoint:    '/pubapi/v1/ai/kb/{kb-id}/ask',
        mutating:    false,
        body_params: {
            question:         { type: 'string',  required: true,  description: 'Natural-language question' },
            includeCitations: { type: 'boolean', required: false, description: 'Include source citations in response' },
            chatHistory:      { type: 'object',  required: false, description: 'Prior conversation context: {"messages":[]}' },
        },
        example: 'egnyte ai ask-kb <kb-id> "What is the refund policy?" --json \'{"includeCitations":true}\' --fields response,citations',
    },
    'ai.list-kbs': {
        summary:  'List available Knowledge Bases',
        method:   'POST',
        endpoint: '/pubapi/v1/ai/kb/list',
        mutating: false,
        body_params: {
            sortBy:                    { type: 'array',   required: false, description: 'Sort fields: createdOn | name' },
            sortDirection:             { type: 'array',   required: false, description: 'ASC | DESC' },
            status:                    { type: 'array',   required: false, description: 'Filter by status: ACTIVE | DELETED | CREATED' },
            page:                      { type: 'integer', required: false, description: 'Page number (default 0)' },
            size:                      { type: 'integer', required: false, description: 'Page size (default 200)' },
            createdBy:                 { type: 'integer', required: false, description: 'Filter by creator user ID' },
            createdAfter:              { type: 'integer', required: false, description: 'Unix epoch ms' },
            createdBefore:             { type: 'integer', required: false, description: 'Unix epoch ms' },
            includePlaceholderData:    { type: 'boolean', required: false, description: 'Include placeholder entries' },
            includeProcessingStatistics: { type: 'boolean', required: false, description: 'Include processing stats' },
            includePrompts:            { type: 'boolean', required: false, description: 'Include associated prompts' },
        },
        example: "egnyte ai list-kbs --json '{\"status\":[\"ACTIVE\"],\"sortBy\":[\"name\"],\"sortDirection\":[\"ASC\"]}' --fields content,id,name,status",
    },
    'ai.hybrid-search': {
        summary:  'Semantic + keyword hybrid search across files',
        method:   'POST',
        endpoint: '/pubapi/v1/hybrid-search',
        mutating: false,
        body_params: {
            query:               { type: 'string',  required: true,  description: '3–250 character search query' },
            semanticWeight:      { type: 'number',  required: true,  description: '0.0–1.0; balance of semantic vs keyword matching' },
            folderPath:          { type: 'string',  required: false, description: 'Restrict results to a folder path' },
            collectionId:        { type: 'string',  required: false, description: 'Restrict results to a Knowledge Base ID' },
            createdBy:           { type: 'string',  required: false, description: 'Filter by file creator username' },
            createdAfter:        { type: 'integer', required: false, description: 'Unix epoch ms' },
            createdBefore:       { type: 'integer', required: false, description: 'Unix epoch ms' },
            limit:               { type: 'integer', required: false, description: '1–1000 (default 100)' },
            preferredFolderPath: { type: 'string',  required: false, description: 'Boost results from this folder' },
            excludeFolderPaths:  { type: 'array',   required: false, description: 'Exclude these folder paths' },
            folderPaths:         { type: 'array',   required: false, description: 'Restrict to these folder paths' },
            entryIds:            { type: 'array',   required: false, description: 'Restrict to specific file entry IDs' },
        },
        example: "egnyte ai hybrid-search \"quarterly report\" --json '{\"semanticWeight\":0.7,\"folderPath\":\"/Shared/Finance\",\"limit\":10}' --fields results",
    },

    // ── Agents ──────────────────────────────────────────────────────────────────

    'agents.list': {
        summary:      'List available AI agents',
        method:       'GET',
        endpoint:     '/pubapi/v1/ai/agents/list',
        mutating:     false,
        query_params: {
            sortBy:    { type: 'string', required: false, description: 'Sort field: name | createdOn (default: name)' },
            sortOrder: { type: 'string', required: false, description: 'asc | desc (default: asc)' },
        },
        example: "egnyte agents list --fields agentId,name,status,category",
    },
    'agents.ask': {
        summary:     'Submit a question to an agent and poll until complete (async)',
        method:      'POST',
        endpoint:    '/pubapi/v1/ai/agents/{agentId}/ask',
        mutating:    false,
        body_params: {
            question:       { type: 'string',  required: true,  description: 'Natural-language question (max 35,000 chars)' },
            instructions:   { type: 'string',  required: false, description: 'Custom system prompt / behavior override' },
            conversationId: { type: 'string',  required: false, description: 'Continue a prior conversation (multi-turn)' },
            chatHistory:    { type: 'object',  required: false, description: 'Prior messages array for context' },
            entryIds:       { type: 'array',   required: false, description: 'File entry IDs to use as context' },
            selectedItems:  { type: 'object',  required: false, description: 'Files/folders: {"files":[{"entryId":"...","filePath":"..."}],"folders":[{"id":"..."}]}' },
        },
        flags: {
            'no-wait': { description: 'Return requestId immediately; skip polling. Check status with agents.status.' },
        },
        example: 'egnyte agents ask <agentId> "Summarize Q3 results" --fields responseText,citations',
    },
    'agents.status': {
        summary:      'Get execution status of a prior agent ask',
        method:       'GET',
        endpoint:     '/pubapi/v1/ai/agents/{agentId}/ask/{requestId}/status',
        mutating:     false,
        response_fields: {
            status:       { type: 'string', description: 'PENDING | RUNNING | COMPLETED | FAILED' },
            responseText: { type: 'string', description: 'Agent answer (present when COMPLETED)' },
            citations:    { type: 'array',  description: 'Source references' },
            lastUpdated:  { type: 'string', description: 'ISO 8601 timestamp' },
        },
        example: 'egnyte agents status <agentId> <requestId> --fields status,responseText',
    },

    // ── File Locking ────────────────────────────────────────────────────────────

    'lock.lock': {
        summary:     'Lock a file to prevent concurrent edits',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs/{path}',
        mutating:    true,
        body_params: {
            lock_token:   { type: 'string',  required: false, description: 'Custom lock token (generated if omitted)' },
            lock_timeout: { type: 'integer', required: false, description: 'Lock timeout in seconds' },
        },
        example: "egnyte lock lock /Shared/report.pdf --json '{\"lock_token\":\"my-token\",\"lock_timeout\":300}' --dry-run",
    },
    'lock.unlock': {
        summary:     'Unlock a previously locked file',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs/{path}',
        mutating:    true,
        body_params: {
            lock_token: { type: 'string', required: false, description: 'Lock token used when locking (required if token was set)' },
        },
        example: "egnyte lock unlock /Shared/report.pdf --json '{\"lock_token\":\"my-token\"}' --dry-run",
    },
    'lock.get': {
        summary:     'Get the lock status of a file',
        method:      'GET',
        endpoint:    '/pubapi/v1/fs/{path}',
        mutating:    false,
        query_params: {},
        example:     'egnyte lock get /Shared/report.pdf --fields locked,lock_owner,lock_timeout',
    },

    // ── Trash ───────────────────────────────────────────────────────────────────
    // Note: List uses v2 for better filtering/pagination, while Restore/Purge 
    // remain on v1 as per current Egnyte public API documentation.

    'trash.list': {
        summary:  'List items in the trash with optional pagination',
        method:   'GET',
        endpoint: '/pubapi/v2/fs/trash',
        mutating: false,
        query_params: {
            offset: { type: 'integer', required: false, description: 'Pagination offset' },
            count:  { type: 'integer', required: false, description: 'Number of items to return' },
        },
        example: "egnyte trash list --json '{\"count\": 50}' --fields items.name,items.path,items.size",
    },
    'trash.restore': {
        summary:     'Restore items from the trash',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs/trash',
        mutating:    true,
        body_params: {
            ids:       { type: 'array',  required: true, description: 'Array of trash item IDs to restore (max 10)' },
        },
        example: "egnyte trash restore --json '{\"ids\": [\"item_id_1\"]}' --dry-run",
    },
    'trash.delete': {
        summary:     'Permanently delete items from the trash',
        method:      'POST',
        endpoint:    '/pubapi/v1/fs/trash',
        mutating:    true,
        body_params: {
            ids:       { type: 'array',  required: true, description: 'Array of trash item IDs to permanently delete (max 10)' },
        },
        example: "egnyte trash delete --json '{\"ids\": [\"item_id_1\"]}' --dry-run",
    },

    // ── Projects ────────────────────────────────────────────────────────────────

    'projects.list': {
        summary:     'List all project folders in the domain',
        method:      'GET',
        endpoint:    '/pubapi/v2/project-folders',
        mutating:    false,
        query_params: {},
        example:     'egnyte projects list --fields name,id,status',
    },
    'projects.get': {
        summary:     'Get a specific project by its ID',
        method:      'GET',
        endpoint:    '/pubapi/v2/project-folders/{project_id}',
        mutating:    false,
        path_params: {
            project_id: { type: 'string', required: true, description: 'Unique identifier for the project' },
        },
        example:     'egnyte projects get a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --fields name,status',
    },
    'projects.create': {
        summary:     'Create a new project folder from a template or mark an existing folder as a project',
        method:      'POST',
        endpoint:    '/pubapi/v2/project-folders', // Defaulting to v2 (template) in schema, but implementation handles both
        mutating:    true,
        body_params: {
            name:           { type: 'string', required: true,  description: 'Project name' },
            status:         { type: 'string', required: true,  description: 'Project status: pending, in-progress, completed, on-hold, or canceled' },
            parentFolderId: { type: 'string', required: false, description: 'Folder ID where the new project will be created (template only)' },
            templateFolderId: { type: 'string', required: false, description: 'Folder ID of the project template (template only)' },
            folderName:     { type: 'string', required: false, description: 'Name of the new folder to create (template only)' },
            rootFolderId:   { type: 'string', required: false, description: 'Folder ID of the existing folder to mark as a project (mark only)' },
            description:    { type: 'string', required: false, description: 'Project description' },
        },
        example:     "egnyte projects create --json '{\"name\": \"New HQ\", \"status\": \"pending\", \"parentFolderId\": \"...\", \"templateFolderId\": \"...\", \"folderName\": \"New HQ Folder\"}' --dry-run",
    },
    'projects.update': {
        summary:     'Update an existing project folder metadata',
        method:      'PATCH',
        endpoint:    '/pubapi/v2/project-folders/{project_id}',
        mutating:    true,
        path_params: {
            project_id: { type: 'string', required: true, description: 'Unique identifier for the project' },
        },
        body_params: {
            name:        { type: 'string', required: false, description: 'Project name' },
            status:      { type: 'string', required: false, description: 'Project status' },
            description: { type: 'string', required: false, description: 'Project description' },
        },
        example:     "egnyte projects update a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --json '{\"status\": \"completed\"}' --dry-run",
    },
    'projects.delete': {
        summary:     'Delete project metadata from a folder (demote to normal folder)',
        method:      'DELETE',
        endpoint:    '/pubapi/v2/project-folders/{project_id}',
        mutating:    true,
        path_params: {
            project_id: { type: 'string', required: true, description: 'Unique identifier for the project' },
        },
        example:     'egnyte projects delete a69bd625-1dc3-4dcf-98f5-8e3e3fbb0b29 --dry-run',
    },
};

[
    'fs.action', 'fs.mkdir', 'fs.rename', 'fs.move', 'fs.copy',
    'fs.delete', 'fs.upload', 'fs.upload-chunked', 'fs.set-metadata',
    'links.create', 'links.delete',
    'users.create', 'users.update', 'users.delete',
    'groups.create', 'groups.update', 'groups.delete',
    'perms.set-user', 'perms.delete-user', 'perms.set-group', 'perms.delete-group',
    'notes.add', 'notes.delete',
    'lock.lock', 'lock.unlock',
    'trash.restore', 'trash.delete',
    'projects.create', 'projects.update', 'projects.delete',
    'request',
].forEach(function(op) {
    if (!SCHEMA[op]) return;
    SCHEMA[op].flags = Object.assign({}, BULK_MUTATION_FLAGS, SCHEMA[op].flags || {});
});

['fs.download', 'fs.download-by-id', 'fs.upload', 'fs.upload-chunked'].forEach(function(op) {
    if (!SCHEMA[op]) return;
    SCHEMA[op].flags = Object.assign({}, TRANSFER_PROGRESS_FLAGS, SCHEMA[op].flags || {});
});

module.exports = { SCHEMA };
