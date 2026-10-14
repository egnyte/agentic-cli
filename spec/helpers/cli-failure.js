'use strict';

// Only emit fixed labels, never API messages, paths, URLs or raw stderr.
// fatal() preserves native Error.message but does not serialize native Error.code.
const nativeCodes = Object.keys(require('os').constants.errno).concat([
    'ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL',
    'ERR_STREAM_PREMATURE_CLOSE', 'ERR_HTTP_CONTENT_LENGTH_MISMATCH',
    'ERR_INVALID_CHAR', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE',
    'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'HPE_UNEXPECTED_CONTENT_LENGTH', 'HPE_INVALID_CONTENT_LENGTH',
    'HPE_INVALID_CHUNK_SIZE', 'HPE_INVALID_HEADER_TOKEN',
    'HPE_INVALID_CONSTANT', 'HPE_INVALID_EOF_STATE', 'HPE_HEADER_OVERFLOW',
]);

const messageKinds = [
    [/^Parse Error: Content-Length can't be present with Transfer-Encoding$/, 'HTTP_CONFLICTING_LENGTH_HEADERS'],
    [/^Parse Error: Duplicate Content-Length$/, 'HTTP_DUPLICATE_CONTENT_LENGTH'],
    [/^Parse Error: Invalid character in Content-Length$/, 'HTTP_INVALID_CONTENT_LENGTH'],
    [/^Parse Error: Invalid character in chunk size$/, 'HTTP_INVALID_CHUNK_SIZE'],
    [/^Parse Error: Expected HTTP\/$/, 'HTTP_INVALID_STATUS_LINE'],
    [/^Parse Error: Header overflow$/, 'HTTP_HEADER_OVERFLOW'],
    [/^Parse Error:/, 'HTTP_PARSE_ERROR'],
    [/^aborted$/, 'RESPONSE_ABORTED'],
    [/^socket hang up$/, 'SOCKET_HANG_UP'],
    [/^Premature close$/, 'STREAM_PREMATURE_CLOSE'],
    [/^Download timed out \(no data for 5 minutes\)$/, 'DOWNLOAD_IDLE_TIMEOUT'],
    [/^getaddrinfo /, 'DNS_ERROR'],
    [/^(certificate has expired|self-signed certificate|unable to verify the first certificate|unable to get local issuer certificate)$/, 'TLS_CERTIFICATE_ERROR'],
    [/^(TypeError:|ReferenceError:|SyntaxError:)/m, 'UNCAUGHT_JAVASCRIPT_ERROR'],
];

// Leading words of an unmatched message, plain words only, so identifiers,
// paths, hosts and credentials are replaced instead of copied into the CI log.
function safeShape(source) {
    return source.trim().split(/\s+/).filter(Boolean).slice(0, 6).map(function(word) {
        return /^[A-Za-z][A-Za-z-]*[.,:;!?]?$/.test(word) ? word : '<redacted>';
    }).join(' ') || '<empty>';
}

function formatCliFailure(result) {
    const error = result.errorJson();
    const httpStatus = error && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599
        ? error.status : 'not reported';
    const message = error && typeof error.error === 'string' ? error.error : '';
    const source = message || (typeof result.stderr === 'string' ? result.stderr : '');
    const code = nativeCodes.find(function(value) {
        return (error && error.code === value) || new RegExp('\\b' + value + '\\b').test(source);
    });
    const kind = messageKinds.find(function(entry) { return entry[0].test(source); });
    const category = code || (kind ? kind[1] : (httpStatus !== 'not reported' ? 'HTTP_ERROR' : 'UNCLASSIFIED'));
    const exit = Number.isInteger(result.status) ? result.status : 'not reported';
    return 'CLI exit ' + exit + ', HTTP status ' + httpStatus + ', category ' + category +
        ', stderr format ' + (message ? 'JSON error' : (source ? 'non-JSON' : 'empty')) +
        (category === 'UNCLASSIFIED' ? ', shape ' + safeShape(source) : '');
}

module.exports = { formatCliFailure };
