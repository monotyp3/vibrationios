// Copies the browser builds of Capacitor core and the Socket.io client into
// www/vendor so the app works with plain <script> tags (no bundler needed).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www', 'vendor');
fs.mkdirSync(out, { recursive: true });

const files = [
  ['@capacitor/core/dist/capacitor.js', 'capacitor.js'],
  ['socket.io-client/dist/socket.io.min.js', 'socket.io.min.js'],
];

for (const [src, dest] of files) {
  const from = path.join(root, 'node_modules', ...src.split('/'));
  if (!fs.existsSync(from)) {
    console.error(`Missing ${src}. Run "npm install" first.`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(out, dest));
  console.log(`vendor: ${dest}`);
}
