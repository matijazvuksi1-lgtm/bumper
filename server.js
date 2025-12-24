// server.js — Render compatible static server (FIXED for ?replay=...)
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
  // ✅ strip query first
  let file = (req.url || "/").split("?")[0];

  // ✅ map "/" to index.html (works for "/?replay=...")
  if (file === "/") file = "/index.html";

  const filePath = path.join(ROOT, file);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
