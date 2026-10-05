const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'dayflow.db');

// Initialize SQLite Database
const db = new DatabaseSync(DB_FILE);

// Setup SQLite Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    email TEXT COLLATE NOCASE,
    name TEXT,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_data (
    user_id INTEGER PRIMARY KEY,
    data TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

console.log(`[SQLite] Database initialized at ${DB_FILE}`);

// Password hashing helpers
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const testHash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateUid() {
  return 'u_' + crypto.randomBytes(8).toString('hex');
}

// Auth helper from Authorization header
function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const stmt = db.prepare(`
      SELECT u.id, u.uid, u.username, u.email, u.name, s.token
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ?
    `);
    const user = stmt.get(token);
    return user || null;
  } catch (err) {
    console.error('Error fetching auth user:', err);
    return null;
  }
}

// JSON body parser helper
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) { // 10MB limit
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// JSON response helper
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// Static MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

// HTTP Server Request Handler
const server = http.createServer(async (req, res) => {
  // Enable CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  // API Routes
  if (pathname.startsWith('/api/')) {
    try {
      // 1. Database Health Check
      if (pathname === '/api/status' && req.method === 'GET') {
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        return sendJson(res, 200, {
          ok: true,
          database: 'SQLite',
          status: 'connected',
          usersRegistered: userCount
        });
      }

      // 2. Register
      if (pathname === '/api/register' && req.method === 'POST') {
        const body = await parseBody(req);
        const username = String(body.username || '').trim();
        const password = String(body.password || '').trim();
        const name = String(body.name || username || '').trim();
        const email = String(body.email || '').trim();

        if (!username || username.length < 2) {
          return sendJson(res, 400, { ok: false, error: 'Username must be at least 2 characters long' });
        }
        if (!password || password.length < 4) {
          return sendJson(res, 400, { ok: false, error: 'Password must be at least 4 characters long' });
        }

        // Check if username or email already exists
        let existing = null;
        if (email) {
          existing = db.prepare(`SELECT id FROM users WHERE username = ? OR email = ?`).get(username, email);
        } else {
          existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
        }
        if (existing) {
          return sendJson(res, 409, { ok: false, error: 'Username or email is already taken' });
        }

        const uid = generateUid();
        const { hash, salt } = hashPassword(password);

        // Insert user
        const insertUser = db.prepare(`
          INSERT INTO users (uid, username, email, name, password_hash, salt)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = insertUser.run(uid, username, email, name, hash, salt);
        const userId = Number(result.lastInsertRowid);

        // Create initial session token
        const token = generateToken();
        db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);

        // Create empty user data record
        db.prepare('INSERT OR REPLACE INTO user_data (user_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').run(userId, JSON.stringify({}));

        return sendJson(res, 201, {
          ok: true,
          message: 'Account created successfully',
          token,
          user: {
            uid,
            username,
            displayName: name || username,
            email
          }
        });
      }

      // 3. Login
      if (pathname === '/api/login' && req.method === 'POST') {
        const body = await parseBody(req);
        const identifier = String(body.username || body.email || '').trim();
        const password = String(body.password || '').trim();

        if (!identifier || !password) {
          return sendJson(res, 400, { ok: false, error: 'Please enter username/email and password' });
        }

        // Look up user by username or email
        const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(identifier, identifier);
        if (!user) {
          return sendJson(res, 401, { ok: false, error: 'User not found. Check username or create account.' });
        }

        // Verify password
        const isValid = verifyPassword(password, user.password_hash, user.salt);
        if (!isValid) {
          return sendJson(res, 401, { ok: false, error: 'Incorrect password' });
        }

        // Create new session token
        const token = generateToken();
        db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);

        // Fetch user data from SQLite
        const row = db.prepare('SELECT data FROM user_data WHERE user_id = ?').get(user.id);
        let userData = null;
        if (row && row.data) {
          try { userData = JSON.parse(row.data); } catch (e) { userData = null; }
        }

        return sendJson(res, 200, {
          ok: true,
          token,
          user: {
            uid: user.uid,
            username: user.username,
            displayName: user.name || user.username,
            email: user.email
          },
          data: userData
        });
      }

      // 4. Current User (/api/me)
      if (pathname === '/api/me' && req.method === 'GET') {
        const authUser = getAuthUser(req);
        if (!authUser) {
          return sendJson(res, 401, { ok: false, error: 'Not authenticated' });
        }
        return sendJson(res, 200, {
          ok: true,
          user: {
            uid: authUser.uid,
            username: authUser.username,
            displayName: authUser.name || authUser.username,
            email: authUser.email
          }
        });
      }

      // 5. Get User Data (/api/data)
      if (pathname === '/api/data' && req.method === 'GET') {
        const authUser = getAuthUser(req);
        if (!authUser) {
          return sendJson(res, 401, { ok: false, error: 'Not authenticated' });
        }
        const row = db.prepare('SELECT data, updated_at FROM user_data WHERE user_id = ?').get(authUser.id);
        let data = null;
        if (row && row.data) {
          try { data = JSON.parse(row.data); } catch (e) { data = null; }
        }
        return sendJson(res, 200, {
          ok: true,
          data,
          updatedAt: row ? row.updated_at : null
        });
      }

      // 6. Save User Data (/api/data)
      if (pathname === '/api/data' && req.method === 'POST') {
        const authUser = getAuthUser(req);
        if (!authUser) {
          return sendJson(res, 401, { ok: false, error: 'Not authenticated' });
        }
        const body = await parseBody(req);
        const dataJson = typeof body.data === 'string' ? body.data : JSON.stringify(body.data || body);

        db.prepare(`
          INSERT INTO user_data (user_id, data, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
        `).run(authUser.id, dataJson);

        return sendJson(res, 200, { ok: true, message: 'Saved to SQLite successfully' });
      }

      // 7. Logout (/api/logout)
      if (pathname === '/api/logout' && req.method === 'POST') {
        const authHeader = req.headers['authorization'] || '';
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (token) {
          db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        }
        return sendJson(res, 200, { ok: true, message: 'Logged out' });
      }

      // 8. Delete Account (/api/account)
      if (pathname === '/api/account' && req.method === 'DELETE') {
        const authUser = getAuthUser(req);
        if (!authUser) {
          return sendJson(res, 401, { ok: false, error: 'Not authenticated' });
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(authUser.id);
        return sendJson(res, 200, { ok: true, message: 'Account deleted' });
      }

      return sendJson(res, 404, { ok: false, error: 'API endpoint not found' });
    } catch (err) {
      console.error('API Error:', err);
      return sendJson(res, 500, { ok: false, error: 'Server error: ' + err.message });
    }
  }

  // Serve Static Files
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') {
    safePath = '/index.html';
  }

  const filePath = path.join(__dirname, safePath);

  // Security check: ensure filePath is within directory
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

let currentPort = PORT;
function startServer(port) {
  server.listen(port, () => {
    console.log(`\n==============================================`);
    console.log(`🚀 DayFlow SQLite Server running at:`);
    console.log(`   👉 http://localhost:${port}`);
    console.log(`📁 SQLite Database: ${DB_FILE}`);
    console.log(`==============================================\n`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[Server] Port ${currentPort} is in use, trying port ${currentPort + 1}...`);
    currentPort++;
    startServer(currentPort);
  } else {
    console.error('[Server] Fatal error:', err);
  }
});

startServer(currentPort);

