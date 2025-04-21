const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'medx.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create tables for customers and retailers
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS retailers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      shopKeeperName TEXT NOT NULL,
      shopName TEXT NOT NULL,
      password TEXT NOT NULL,
      live INTEGER DEFAULT 0,
      location TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      shopKeeperName TEXT NOT NULL,
      password TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS purchase_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      retailer_id INTEGER NOT NULL,
      medicine_name TEXT NOT NULL,
      quantity INTEGER,
      price REAL,
      expiry_date TEXT,
      message TEXT,
      purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (retailer_id) REFERENCES retailers(id)
    )
  `);
});

module.exports = db;
