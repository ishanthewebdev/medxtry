const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, 'medx.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run('BEGIN TRANSACTION;');

  // Create new table with quantity column
  db.run(`
    CREATE TABLE IF NOT EXISTS purchase_history_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      retailer_id INTEGER NOT NULL,
      medicine_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      price REAL,
      expiry_date TEXT,
      message TEXT,
      purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (retailer_id) REFERENCES retailers(id)
    );
  `, (err) => {
    if (err) {
      console.error('Error creating new purchase_history table:', err.message);
      db.run('ROLLBACK;');
      process.exit(1);
    }
  });

  // Copy data from old table to new table, setting quantity to 1
  db.run(`
    INSERT INTO purchase_history_new (id, customer_id, retailer_id, medicine_name, price, expiry_date, message, purchase_date, quantity)
    SELECT id, customer_id, retailer_id, medicine_name, price, expiry_date, message, purchase_date, 1 FROM purchase_history;
  `, (err) => {
    if (err) {
      console.error('Error copying data to new purchase_history table:', err.message);
      db.run('ROLLBACK;');
      process.exit(1);
    }
  });

  // Drop old purchase_history table
  db.run(`DROP TABLE purchase_history;`, (err) => {
    if (err) {
      console.error('Error dropping old purchase_history table:', err.message);
      db.run('ROLLBACK;');
      process.exit(1);
    }
  });

  // Rename new table to purchase_history
  db.run(`ALTER TABLE purchase_history_new RENAME TO purchase_history;`, (err) => {
    if (err) {
      console.error('Error renaming purchase_history_new table:', err.message);
      db.run('ROLLBACK;');
      process.exit(1);
    }
  });

  db.run('COMMIT;', (err) => {
    if (err) {
      console.error('Error committing transaction:', err.message);
      process.exit(1);
    }
    console.log('Migration completed successfully.');
    db.close();
  });
});
