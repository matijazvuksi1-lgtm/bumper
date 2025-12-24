// server.js — Render compatible static server (FIXED for /?replay=...)
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json"
};

http.createServer((req, res) => {
  let pathname = (req.url || "/").split("?")[0];
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.join(ROOT, pathname);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      ...(ext === ".json" ? {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
      } : {})
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`✅ Game running on port ${PORT}`);
});
