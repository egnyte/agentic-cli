'use strict';

const { parseArgs }                              = require('./lib/args');
const { fatal }                                  = require('./lib/output');
const { setVerbose }                             = require('./lib/http');
const { cmdLogin, cmdLogout,
        cmdWhoami, cmdProfiles,
        cmdUserInfo }                            = require('./commands/auth');
const { cmdFsGet, cmdFsAction, cmdFsDelete,
        cmdFsUpload, cmdFsDownload,
        cmdFsDownloadById, cmdFsUploadChunked,
        cmdFsMkdir, cmdFsRename,
        cmdFsMove, cmdFsCopy,
        cmdFsGetContent, cmdFsListMetadataNamespaces,
        cmdFsSetMetadata }                       = require('./commands/fs');
const { cmdSearch, cmdSearchAdvanced }           = require('./commands/search');
const { cmdLinksCreate, cmdLinksList,
        cmdLinksGet, cmdLinksDelete }            = require('./commands/links');
const { cmdUsersGet, cmdUsersList,
        cmdUsersCreate, cmdUsersUpdate,
        cmdUsersDelete }                         = require('./commands/users');
const { cmdGroupsGet, cmdGroupsList,
        cmdGroupsCreate, cmdGroupsUpdate,
        cmdGroupsDelete }                        = require('./commands/groups');
const { cmdPermsGetUser, cmdPermsSetUser,
        cmdPermsDeleteUser, cmdPermsGetGroup,
        cmdPermsSetGroup, cmdPermsDeleteGroup,
        cmdPermsGetByUser }                      = require('./commands/perms');
const { cmdEventsGetCursor,
        cmdEventsList }                          = require('./commands/events');
const { cmdNotesAdd, cmdNotesList,
        cmdNotesGet, cmdNotesDelete }            = require('./commands/notes');
const { cmdLockLock, cmdLockUnlock,
        cmdLockGet }                             = require('./commands/lock');
const { cmdTrashList, cmdTrashRestore,
        cmdTrashDelete }                         = require('./commands/trash');
const { cmdProjectsList, cmdProjectsGet,
        cmdProjectsCreate, cmdProjectsUpdate,
        cmdProjectsDelete }                      = require('./commands/projects');
const { cmdSchema }                              = require('./commands/schema');
const { cmdRequest }                             = require('./commands/request');
const { cmdAiAsk, cmdAiStatus, cmdAiAskDocument,
        cmdAiSummarize, cmdAiAskKb,
        cmdAiListKbs, cmdAiHybridSearch }        = require('./commands/ai');
const { cmdAgentsList, cmdAgentsAsk,
        cmdAgentsStatus }                        = require('./commands/agents');

// ── Command dispatch table ────────────────────────────────────────────────────

const DISPATCH = {
    // Auth
    'login':                cmdLogin,
    'logout':               cmdLogout,
    'whoami':               cmdWhoami,

    // File System
    'fs.get':               cmdFsGet,
    'fs.action':            cmdFsAction,
    'fs.delete':            cmdFsDelete,
    'fs.upload':            cmdFsUpload,
    'fs.upload-chunked':    cmdFsUploadChunked,
    'fs.download':          cmdFsDownload,
    'fs.download-by-id':    cmdFsDownloadById,
    'fs.mkdir':             cmdFsMkdir,
    'fs.rename':            cmdFsRename,
    'fs.move':              cmdFsMove,
    'fs.copy':              cmdFsCopy,

    // User Info
    'userinfo':             cmdUserInfo,

    // Links
    'links.create':         cmdLinksCreate,
    'links.list':           cmdLinksList,
    'links.get':            cmdLinksGet,
    'links.delete':         cmdLinksDelete,

    // Users
    'users.get':            cmdUsersGet,
    'users.list':           cmdUsersList,
    'users.create':         cmdUsersCreate,
    'users.update':         cmdUsersUpdate,
    'users.delete':         cmdUsersDelete,

    // Groups
    'groups.get':           cmdGroupsGet,
    'groups.list':          cmdGroupsList,
    'groups.create':        cmdGroupsCreate,
    'groups.update':        cmdGroupsUpdate,
    'groups.delete':        cmdGroupsDelete,

    // Permissions
    'perms.get-user':       cmdPermsGetUser,
    'perms.set-user':       cmdPermsSetUser,
    'perms.delete-user':    cmdPermsDeleteUser,
    'perms.get-group':      cmdPermsGetGroup,
    'perms.set-group':      cmdPermsSetGroup,
    'perms.delete-group':   cmdPermsDeleteGroup,
    'perms.get-by-user':    cmdPermsGetByUser,

    // Events
    'events.get-cursor':    cmdEventsGetCursor,
    'events.list':          cmdEventsList,

    // Notes
    'notes.add':            cmdNotesAdd,
    'notes.list':           cmdNotesList,
    'notes.get':            cmdNotesGet,
    'notes.delete':         cmdNotesDelete,

    // Locking
    'lock.lock':            cmdLockLock,
    'lock.unlock':          cmdLockUnlock,
    'lock.get':             cmdLockGet,

    // Trash
    'trash.list':           cmdTrashList,
    'trash.restore':        cmdTrashRestore,
    'trash.delete':         cmdTrashDelete,

    // Projects
    'projects.list':        cmdProjectsList,
    'projects.get':         cmdProjectsGet,
    'projects.create':      cmdProjectsCreate,
    'projects.update':      cmdProjectsUpdate,
    'projects.delete':      cmdProjectsDelete,

    // Agents
    'agents.list':          cmdAgentsList,
    'agents.ask':           cmdAgentsAsk,
    'agents.status':        cmdAgentsStatus,

    // AI
    'ai.ask':               cmdAiAsk,
    'ai.status':            cmdAiStatus,
    'ai.ask-document':      cmdAiAskDocument,
    'ai.summarize':         cmdAiSummarize,
    'ai.ask-kb':            cmdAiAskKb,
    'ai.list-kbs':          cmdAiListKbs,
    'ai.hybrid-search':     cmdAiHybridSearch,

    // File System — metadata & content
    'fs.get-content':               cmdFsGetContent,
    'fs.set-metadata':              cmdFsSetMetadata,
    'fs.list-metadata-namespaces':  cmdFsListMetadataNamespaces,
};

// ── Help ──────────────────────────────────────────────────────────────────────

function printHelp() {
    process.stdout.write(`
Usage: egnyte <group> <command> [options]

Auth:
  login   --domain <d> [--client-id <id> --client-secret <s> [--redirect-uri <url>]] [--profile <name>]
  logout  [--profile <name>]
  whoami  [--profile <name>]
  profiles list | use <name> | remove <name>

File System:
  fs get <path>                                Get metadata or list folder contents
  fs action <path> --json '{}'                 add_folder | move | copy | rename
  fs delete <path>                             Delete a file or folder
  fs mkdir <path>                              Create a folder
  fs rename <path> --name <new-name>           Rename a file or folder
  fs move <path> --to <destination>            Move a file or folder
  fs copy <path> --to <destination>            Copy a file or folder
  fs upload <path> --file <local>              Upload a local file
  fs upload-chunked <path> --file <local>      Upload a large file (chunked, > 10 MB)
  fs upload-chunked <path> --file <local> --resume  Resume an interrupted chunked upload
  fs download <path> --out <local>             Download a file by path
  fs download <path> --out <local> --resume    Resume an interrupted download
  fs download-by-id <id> --out <local>         Download a file by ID
  fs download-by-id <id> --out <local> --resume  Resume an interrupted download by ID
  fs get-content <path> [--json '{}']          Fetch text content of a file (paginated)
  fs list-metadata-namespaces                  List all custom metadata namespaces
  fs set-metadata <path> --json '{}'           Set custom metadata on a file

Search:
  search <query> [--json '{}']                 Search for files and folders
  search advanced <query> [--json '{}']        Advanced search with metadata/date filters

Links:
  links create --json '{}'               Create a shared link
  links list [--json '{}']               List shared links
  links get <id>                         Get a link by ID
  links delete <id>                      Delete a link

Users:
  users get <id>                         Get a user by ID
  users list [--json '{}']               List users
  users create --json '{}'               Create a user
  users update <id> --json '{}'          Update a user (PATCH)
  users delete <id>                      Delete a user

Groups:
  groups get <id>                        Get a group by ID
  groups list [--json '{}']              List groups
  groups create --json '{}'              Create a group
  groups update <id> --json '{}'         Update a group (PATCH)
  groups delete <id>                     Delete a group

Permissions:
  perms get-user <path>                  Get all users with permissions on a folder
  perms set-user <path> --json '{}'      Set user permissions on a folder
  perms delete-user <path> --json '{}'   Remove user permissions from a folder
  perms get-group <path>                 Get all groups with permissions on a folder
  perms set-group <path> --json '{}'     Set group permissions on a folder
  perms delete-group <path> --json '{}'  Remove group permissions from a folder
  perms get-by-user <username>           Get all folder permissions for a user

Events (Audit Trail):
  events get-cursor                      Get latest event ID (start point for polling)
  events list --json '{}'                List audit events from a start ID

Notes:
  notes add <path> --json '{}'           Add a note/comment to a file
  notes list <path>                      List all notes on a file
  notes get <note-id>                    Get a single note by ID
  notes delete <note-id>                 Delete a note

File Locking:
  lock lock <path> [--json '{}']         Lock a file to prevent concurrent edits
  lock unlock <path> [--json '{}']       Unlock a file
  lock get <path>                        Get lock status of a file

Trash:
  trash list [--json '{}']               List items in the trash
  trash restore --json '{}'              Restore items from the trash
  trash delete --json '{}'               Permanently delete items from the trash

Projects:
  projects list [--json '{}']            List all project folders
  projects get <id>                      Get project by ID
  projects create --json '{}'            Create project from template or mark existing folder
  projects update <id> --json '{}'       Update project metadata
  projects delete <id>                   Delete project metadata from a folder

Agents:
  agents list [--json '{}']                        List available agents
  agents ask <agentId> "<question>" [--json '{}']  Ask an agent (polls until done; use --no-wait to return immediately)
  agents status <agentId> <requestId>              Check execution status of a prior ask

AI:
  ai ask "<question>" --yes|--dry-run [--json '{}'] Ask the AI Assistant (async; polls until done; --no-wait to return immediately)
  ai status <executionId>                          Check execution status of a prior ai ask
  ai ask-document <path> "<question>" [--json '{}'] Ask a question about a specific file
  ai summarize <path>                              Summarize the content of a file
  ai list-kbs [--json '{}']                        List available Knowledge Bases
  ai ask-kb <kb-id> "<question>" [--json '{}']     Query a specific Knowledge Base
  ai hybrid-search "<query>" [--json '{}']         Semantic + keyword hybrid search

User Info:
  userinfo [--fields username,email]     Get authenticated user's live profile from API

Escape Hatch:
  request <api-path> [-X METHOD] [--json '{}'] [--fields a,b]
                                         Call any Egnyte API endpoint directly

Discovery:
  schema --list                          List all available operations
  schema <operation>                     Full parameter reference

Auth Precedence (highest \u2192 lowest):
  1. --token / --domain flags
  2. EGNYTE_TOKEN / EGNYTE_DOMAIN env vars   (CI / headless agents)
  3. Stored profile  ~/.config/egnyte-cli/config.json

Flags:
  --json '{}'           JSON request body or query params (maps to API schema)
  --fields a,b,c        Limit response fields (reduces AI token cost)
  --dry-run             Preview the request without executing (mutating ops only)
  --yes                 Confirm execution of a mutating operation
  --bulk-file-path <p>  Execute one row per CSV record for supported commands
  --from-csv <p>        Alias for --bulk-file-path
  --parallelism <n>     Max in-flight bulk operations (default: 2)
  --progress            Write human progress updates to stderr
  --json-progress       Write newline-delimited JSON progress events to stderr
  --resume              Resume an interrupted download or chunked upload
  --verbose             Include rate-limit headers in output (_ratelimit field)
  --profile <name>      Use a named profile instead of default
  --token / --domain    Override stored credentials for one call

Examples:
  egnyte fs get /Shared --json '{"list_content":true}' --fields name,path,size
  egnyte search "quarterly report" --json '{"count":20}' --fields name,path
  egnyte events get-cursor
  egnyte events list --json '{"id":12345,"count":20,"folder":"/Shared"}'
  egnyte notes add /Shared/report.pdf --json '{"body":"Please review section 3"}'
  egnyte lock lock /Shared/report.pdf --json '{"lock_token":"my-token","lock_timeout":300}' --dry-run
  egnyte request /pubapi/v1/userinfo
  egnyte request /pubapi/v2/users -X GET --json '{"count":10}' --fields id,username,email
  egnyte perms get-by-user jsmith --json '{"folder":"/Shared/Finance"}'
  egnyte userinfo --fields username,email,active
  egnyte fs upload-chunked /Shared/bigfile.iso --file ./bigfile.iso --dry-run
  egnyte fs delete --bulk-file-path ./delete.csv --dry-run
  egnyte fs upload --bulk-file-path ./uploads.csv --parallelism 2 --progress --yes
  egnyte schema --list
`.trimStart());
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const args  = parseArgs(process.argv.slice(2));
    const group = args._[0];
    const cmd   = args._[1];

    if (args.verbose) setVerbose(true);

    if (!group || args.help) { printHelp(); process.exit(0); }

    // These commands handle their own sub-routing internally; second positional
    // is a path/query/name — not a subcommand — so they cannot use DISPATCH[group.cmd].
    if (group === 'search') {
        if (cmd === 'advanced') return cmdSearchAdvanced(args);
        return cmdSearch(args);
    }
    if (group === 'schema')   return cmdSchema(args);
    if (group === 'request')  return cmdRequest(args);
    if (group === 'profiles') return cmdProfiles(args);

    // All other commands: single-word (DISPATCH[group]) or <group>.<subcommand>
    const key = cmd ? group + '.' + cmd : group;
    const fn  = DISPATCH[key];
    if (!fn) throw new Error("Unknown command: '" + group + ' ' + (cmd || '') + "'. Run: egnyte --help");

    await fn(args);
}

main().catch(function(err) {
    fatal(err.message);
});
