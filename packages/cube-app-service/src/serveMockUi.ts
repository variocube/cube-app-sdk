import {extname} from "path";
import {IncomingMessage, ServerResponse} from "node:http";

export async function serveMockUi(request: IncomingMessage, response: ServerResponse) {
    const {pathname} = new URL(request.url ?? "", "http://localhost:5000");

    const files = import.meta.glob('./../../cube-app-mock/dist/**/*', {
        query: "?raw",
        import: 'default'
    });

    const filename = pathname == "/" ? "/index.html" : pathname;

    for (const [key, value] of Object.entries(files)) {
        if (key.endsWith(filename)) {
            const content = await value();
            if (typeof content == "string") {
                response.writeHead(200, {
                    'Content-Type': getMimeType(key),
                    'Content-Length': Buffer.byteLength(content)
                });
                response.end(content);
                return;
            }
        }
    }

    response.writeHead(404);
    response.end("Not Found.");
}

const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm',
    '.ico': 'image/x-icon'
};

function getMimeType(path: string) {
    const extension = String(extname(path)).toLowerCase();

    return mimeTypes[extension] || 'application/octet-stream';
}