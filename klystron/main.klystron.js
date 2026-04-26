import { get } from "./fetch.klystron.js";
import { fix } from "./rewrite.klystron.js";

const textTypes = new Set([
    "text/html",
    "application/xhtml+xml",
    "text/css",
    "application/javascript",
    "application/ecmascript",
    "application/x-javascript",
    "text/javascript",
    "text/ecmascript",
    "application/json",
    "application/ld+json",
    "image/svg+xml",
    "text/xml",
    "application/xml",
    "application/rss+xml",
    "application/atom+xml",
    "application/x-mpegURL",
    "application/vnd.apple.mpegurl",
    "application/dash+xml",
    "text/vtt"
]);

function isTextual(contentType) {
    if (!contentType) return false;
    const mime = contentType.split(";")[0].trim().toLowerCase();
    return (
        mime.startsWith("text/") ||
        textTypes.has(mime) ||
        mime.endsWith("+json") ||
        mime.endsWith("+xml")
    );
}

export default async function proxy(url, options = {}, jar) {
    const response = await get(url, options, jar);
    const type = response.contentType;
    const status = response.status;
    const headers = response.headers;

    if (!isTextual(type) || type.toLowerCase().startsWith("text/event-stream")) {
        return {
            contentType: type,
            body: response.raw.stream,
            status,
            headers
        };
    }

    const text = await response.raw.text();
    const rewritten = await fix(url, text, type);

    return {
        contentType: type,
        body: rewritten,
        status,
        headers
    };
}
