# DayFlow – Personal Daily Planner (SQLite + Vanilla JS)

DayFlow is a full-featured personal planner with real-time SQLite database authentication and data persistence.

## 🚀 How to Run

### 1. Start the SQLite Server
Run with Node.js (no extra npm installations required):
```bash
npm start
# or:
node server.js
```

### 2. Open the App
Visit: **[http://localhost:3000](http://localhost:3000)** (or port `3001` if port 3000 is occupied).

---

## 🗄️ SQLite Database Architecture

Data is stored directly in **`dayflow.db`** using Node's built-in SQLite engine.

### Tables:
1. **`users`**:
   - `id`: Integer Primary Key (Auto increment)
   - `uid`: Unique user identifier
   - `username`: Unique username (case-insensitive)
   - `email`: User email
   - `name`: Full display name
   - `password_hash`: Cryptographically salted hash (`scrypt`)
   - `salt`: Cryptographic random salt
   - `created_at`: Registration timestamp

2. **`sessions`**:
   - `token`: Bearer authentication token
   - `user_id`: Foreign key to `users.id`
   - `created_at`: Session creation timestamp

3. **`user_data`**:
   - `user_id`: Foreign key to `users.id`
   - `data`: Complete JSON state containing tasks, routines, habits, hydration logs, focus sessions, notes, reviews, and settings.
   - `updated_at`: Last synchronized timestamp

---

## 🔑 Features
- **Sign In & Register**: Create local user accounts in SQLite.
- **Auto-Sync**: Every task created, habit checked, water logged, or timer completed automatically saves to SQLite.
- **Remember Session**: Seamlessly logs you in when you revisit the page.
- **Demo Mode**: Instant preview mode storing data in local browser storage.
- **Clean REST API**:
  - `POST /api/register` – Create SQLite user account
  - `POST /api/login` – Authenticate user and return session token
  - `GET /api/me` – Retrieve current user profile
  - `GET /api/data` – Fetch synced user planner data
  - `POST /api/data` – Save user planner data to SQLite
  - `POST /api/logout` – Destroy session token
  - `DELETE /api/account` – Remove user account and all SQLite records

---

## ⌨️ Shortcuts & Tips
- `Ctrl + K` / `Cmd + K`: Global search across tasks, events, habits, notes, and reviews
- `Esc`: Close dialogs and modals
- Drag & Drop: Reorder tasks easily
