// server.js — Render compatible static server
const http = require("http");
const fs = require("fs");
const path = require("path");

// ✅ Render provides PORT automatically
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json"
};

http.createServer((req, res) => {
  let file = req.url === "/" ? "/index.html" : req.url;
  file = file.split("?")[0];

  const filePath = path.join(ROOT, file);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME[ext] || "text/plain"
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
