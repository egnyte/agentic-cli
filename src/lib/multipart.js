'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Build a multipart/form-data body buffer for file uploads.
 * Returns { boundary, data: Buffer }.
 */
function buildMultipart(localFile) {
    const boundary = 'boundary' + Math.random().toString(36).slice(2);
    const filename  = path.basename(localFile).replace(/"/g, '\\"');
    const fileData  = fs.readFileSync(localFile);
    const pre  = Buffer.from(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n\r\n'
    );
    const post = Buffer.from('\r\n--' + boundary + '--\r\n');
    return { boundary, data: Buffer.concat([pre, fileData, post]) };
}

module.exports = { buildMultipart };
